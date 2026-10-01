package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDownloadComponentResumesAndVerifies(t *testing.T) {
	content := []byte(strings.Repeat("verified-component-", 1024))
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if rangeValue := request.Header.Get("Range"); rangeValue != "" {
			var offset int
			if _, err := fmt.Sscanf(rangeValue, "bytes=%d-", &offset); err != nil {
				t.Fatalf("bad Range: %s", rangeValue)
			}
			response.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(content)-1, len(content)))
			response.WriteHeader(http.StatusPartialContent)
			_, _ = response.Write(content[offset:])
			return
		}
		_, _ = response.Write(content)
	}))
	defer server.Close()

	sum := sha256.Sum256(content)
	component := releaseComponent{
		Name: "runtime", Kind: "runtime", URL: server.URL + "/runtime",
		SHA256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(content)),
	}
	destination := filepath.Join(t.TempDir(), "runtime.artifact")
	partial := destination + ".part"
	if err := os.WriteFile(partial, content[:97], 0600); err != nil {
		t.Fatal(err)
	}
	var progress []progressEvent
	if err := downloadComponent(context.Background(), server.Client(), component, destination, 0, component.SizeBytes,
		func(event progressEvent) { progress = append(progress, event) }); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(content) {
		t.Fatal("downloaded bytes changed")
	}
	if _, err := os.Stat(partial); !os.IsNotExist(err) {
		t.Fatalf("partial file remains: %v", err)
	}
	if len(progress) == 0 || progress[len(progress)-1].Percent != 100 {
		t.Fatalf("download did not report completion: %#v", progress)
	}
}

func TestDownloadComponentRetriesAnIdleBodyAndResumes(t *testing.T) {
	content := []byte(strings.Repeat("retryable-download-", 1024))
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		offset := 0
		if rangeValue := request.Header.Get("Range"); rangeValue != "" {
			if _, err := fmt.Sscanf(rangeValue, "bytes=%d-", &offset); err != nil {
				t.Errorf("bad Range: %s", rangeValue)
				return
			}
			response.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(content)-1, len(content)))
			response.WriteHeader(http.StatusPartialContent)
		}
		if requestNumber == 1 {
			_, _ = response.Write(content[:128])
			if flusher, ok := response.(http.Flusher); ok {
				flusher.Flush()
			}
			<-request.Context().Done()
			return
		}
		_, _ = response.Write(content[offset:])
	}))
	defer server.Close()

	previousIdle := downloadIdleTimeout
	previousProgress := downloadProgressInterval
	downloadIdleTimeout = 75 * time.Millisecond
	downloadProgressInterval = 10 * time.Millisecond
	t.Cleanup(func() {
		downloadIdleTimeout = previousIdle
		downloadProgressInterval = previousProgress
	})

	sum := sha256.Sum256(content)
	component := releaseComponent{
		Name: "runtime", Kind: "runtime", URL: server.URL + "/runtime",
		SHA256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(content)),
	}
	destination := filepath.Join(t.TempDir(), "runtime.artifact")
	var progress []progressEvent
	if err := downloadComponent(context.Background(), server.Client(), component, destination, 0, component.SizeBytes,
		func(event progressEvent) { progress = append(progress, event) }); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(content) {
		t.Fatal("resumed bytes changed")
	}
	if requests.Load() < 2 {
		t.Fatalf("idle response was not retried: %d requests", requests.Load())
	}
	var sawHeartbeat, sawRetry bool
	for _, event := range progress {
		sawHeartbeat = sawHeartbeat || event.Heartbeat
		sawRetry = sawRetry || event.Phase == "retry"
	}
	if !sawHeartbeat || !sawRetry {
		t.Fatalf("missing heartbeat/retry progress: %#v", progress)
	}
}

func TestDownloadComponentDeletesCorruptCompletePartial(t *testing.T) {
	content := []byte("correct bytes")
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(content)
	}))
	defer server.Close()
	sum := sha256.Sum256(content)
	component := releaseComponent{Name: "runtime", Kind: "runtime", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(content))}
	destination := filepath.Join(t.TempDir(), "runtime.artifact")
	if err := os.WriteFile(destination+".part", []byte("wrong bytes!!"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := downloadComponent(context.Background(), server.Client(), component, destination, 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
	actual, _ := os.ReadFile(destination)
	if string(actual) != string(content) {
		t.Fatalf("expected repaired content, got %q", actual)
	}
}

func TestSafeInstallRootRejectsFilesystemRoot(t *testing.T) {
	if _, err := safeInstallRoot(string(filepath.Separator)); err == nil {
		t.Fatal("filesystem root was accepted")
	}
	root, err := safeInstallRoot(filepath.Join(t.TempDir(), "bms"))
	if err != nil || root == "" {
		t.Fatalf("safe root rejected: %v", err)
	}
}

func TestDownloadCompleteBodyWithoutEOFDoesNotRequestPastEnd(t *testing.T) {
	content := []byte("complete signed payload")
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Range") != "" {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Write(content)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	previous := downloadIdleTimeout
	downloadIdleTimeout = 75 * time.Millisecond
	t.Cleanup(func() { downloadIdleTimeout = previous })
	sum := sha256.Sum256(content)
	component := releaseComponent{Name: "desktop", URL: server.URL,
		SHA256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(content))}
	destination := filepath.Join(t.TempDir(), "desktop.artifact")
	if err := downloadComponent(context.Background(), server.Client(), component, destination, 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 {
		t.Fatalf("requested past a complete, verified body: %d requests", requests.Load())
	}
	actual, err := os.ReadFile(destination)
	if err != nil || string(actual) != string(content) {
		t.Fatalf("wrong installed bytes: %q, %v", actual, err)
	}
}

func TestDownloadCancellationPreservesPartialAndCanResume(t *testing.T) {
	content := []byte(strings.Repeat("resume", 1024))
	var requests atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.Write(content[:128])
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		// A server ignoring Range must restart at zero without duplicating bytes.
		w.Write(content)
	}))
	defer server.Close()
	sum := sha256.Sum256(content)
	component := releaseComponent{Name: "desktop", URL: server.URL,
		SHA256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(content))}
	destination := filepath.Join(t.TempDir(), "desktop.artifact")
	err := downloadComponent(ctx, server.Client(), component, destination, 0, component.SizeBytes,
		func(event progressEvent) {
			if event.Phase == "download" && event.ComponentCompletedBytes >= 128 {
				cancel()
			}
		})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	partial, err := os.ReadFile(destination + ".part")
	if err != nil || string(partial) != string(content[:128]) {
		t.Fatalf("lost resumable bytes: %d, %v", len(partial), err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("cancelled download was promoted")
	}
	if err := downloadComponent(context.Background(), server.Client(), component, destination, 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(destination)
	if err != nil || string(actual) != string(content) {
		t.Fatalf("restart corrupted the payload: %v", err)
	}
}

func TestAcquireInstallLockRecoversDeadOwner(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".install.lock"), []byte("pid=99999999\nstarted=2026-01-01T00:00:00Z\n"), 0600); err != nil {
		t.Fatal(err)
	}
	unlock, err := acquireInstallLock(root)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestInstallLockRejectsConcurrentOwnerAndRecoversEmptyLock(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".install.lock"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	unlock, err := acquireInstallLock(root)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireInstallLock(root); err == nil {
		second()
		t.Fatal("concurrent installer acquired lock")
	}
	unlock()
	second, err := acquireInstallLock(root)
	if err != nil {
		t.Fatal(err)
	}
	second()
}

func TestTornProgressStateIsRebuiltButCachedBytesAreStillVerified(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "install-state.json")
	if err := os.WriteFile(statePath, []byte(`{"formatVersion":`), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := loadOrCreateState(statePath, releasePayload{ReleaseVersion: "1.0.0", PlatformTarget: "windows-11-x64"})
	if err != nil || len(state.CompletedComponents) != 0 {
		t.Fatalf("recovery: %+v %v", state, err)
	}
	if err := writeState(statePath, state); err != nil {
		t.Fatal(err)
	}
	backups, _ := filepath.Glob(statePath + ".corrupt-*")
	if len(backups) != 1 {
		t.Fatal("missing corrupt-state evidence")
	}
	content := []byte("verified cached artifact")
	path := filepath.Join(root, "desktop.artifact")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	component := releaseComponent{Name: "desktop", SizeBytes: int64(len(content)), SHA256: hashBytes(content), URL: "https://unreachable.invalid"}
	if err := downloadComponent(context.Background(), &http.Client{}, component, path, 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadRepairsCorruptPrefixAndWrongRange(t *testing.T) {
	for _, wrongRange := range []bool{false, true} {
		t.Run(fmt.Sprint(wrongRange), func(t *testing.T) {
			content := []byte("complete verified download content")
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.Header.Get("Range") != "" {
					offset := 4
					if wrongRange {
						offset = 2
					}
					w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(content)-1, len(content)))
					w.WriteHeader(206)
					_, _ = w.Write(content[offset:])
					return
				}
				_, _ = w.Write(content)
			}))
			defer server.Close()
			path := filepath.Join(t.TempDir(), "desktop.artifact")
			if err := os.WriteFile(path+".part", []byte("BAD!"), 0600); err != nil {
				t.Fatal(err)
			}
			component := releaseComponent{Name: "desktop", URL: server.URL, SizeBytes: int64(len(content)), SHA256: hashBytes(content)}
			if err := downloadComponent(context.Background(), server.Client(), component, path, 0, component.SizeBytes); err != nil {
				t.Fatal(err)
			}
			if requests.Load() != 2 {
				t.Fatalf("expected resume then repair: %d requests", requests.Load())
			}
			got, _ := os.ReadFile(path)
			if string(got) != string(content) {
				t.Fatal("corrupted prefix was trusted")
			}
		})
	}
}

func TestDownloadCrashHelper(t *testing.T) {
	root := os.Getenv("BMS_CRASH_TEST_ROOT")
	if root == "" {
		t.Skip("subprocess helper")
	}
	unlock, err := acquireInstallLock(root)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	content := []byte(strings.Repeat("crash-recovery-", 8192))
	component := releaseComponent{Name: "runtime", URL: os.Getenv("BMS_CRASH_TEST_URL"), SizeBytes: int64(len(content)), SHA256: hashBytes(content)}
	if err := downloadComponent(context.Background(), &http.Client{}, component, filepath.Join(root, "runtime.artifact"), 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
}

func TestKilledDownloadProcessResumesOnSecondInstall(t *testing.T) {
	content := []byte(strings.Repeat("crash-recovery-", 8192))
	var resumed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if value := r.Header.Get("Range"); value != "" {
			var offset int
			if _, err := fmt.Sscanf(value, "bytes=%d-", &offset); err != nil || offset < 4096 || offset >= len(content) {
				t.Errorf("unexpected resume range %s", value)
				w.WriteHeader(416)
				return
			}
			resumed.Store(true)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(content)-1, len(content)))
			w.WriteHeader(206)
			_, _ = w.Write(content[offset:])
			return
		}
		_, _ = w.Write(content[:4096])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	root := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestDownloadCrashHelper$")
	cmd.Env = append(os.Environ(), "BMS_CRASH_TEST_ROOT="+root, "BMS_CRASH_TEST_URL="+server.URL)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	path := filepath.Join(root, "runtime.artifact")
	deadline := time.Now().Add(10 * time.Second)
	for {
		info, err := os.Stat(path + ".part")
		if err == nil && info.Size() >= 4096 {
			break
		}
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("child did not download partial bytes")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	unlock, err := acquireInstallLock(root)
	if err != nil {
		t.Fatalf("dead process blocked reinstall: %v", err)
	}
	defer unlock()
	component := releaseComponent{Name: "runtime", URL: server.URL, SizeBytes: int64(len(content)), SHA256: hashBytes(content)}
	if err := downloadComponent(context.Background(), server.Client(), component, path, 0, component.SizeBytes); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if !resumed.Load() || string(got) != string(content) {
		t.Fatal("second install did not resume verified bytes")
	}
}

func TestReleaseStateIsScopedPerVersion(t *testing.T) {
	root := t.TempDir()
	firstPath := filepath.Join(root, "releases", "1.0.0", "install-state.json")
	secondPath := filepath.Join(root, "releases", "1.1.0", "install-state.json")
	if err := os.MkdirAll(filepath.Dir(firstPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(secondPath), 0700); err != nil {
		t.Fatal(err)
	}
	first := releasePayload{PlatformTarget: "ubuntu-24.04-lts-x64", ReleaseVersion: "1.0.0"}
	second := releasePayload{PlatformTarget: "ubuntu-24.04-lts-x64", ReleaseVersion: "1.1.0"}
	firstState, err := loadOrCreateState(firstPath, first)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeState(firstPath, firstState); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOrCreateState(secondPath, second); err != nil {
		t.Fatalf("a different release must have independent resumable state: %v", err)
	}
	if _, err := loadOrCreateState(firstPath, second); err == nil {
		t.Fatal("the same release directory accepted conflicting version state")
	}
}

func TestStageDesktopSelectsOnlySignedDesktopComponent(t *testing.T) {
	desktopBytes := []byte("signed desktop archive")
	desktopDigest := sha256.Sum256(desktopBytes)
	envelope, keyring := signedReleaseFixture(t, func(payload *releasePayload) {
		for index := range payload.Components {
			if payload.Components[index].Name == "desktop" {
				payload.Components[index].SHA256 = hex.EncodeToString(desktopDigest[:])
				payload.Components[index].SizeBytes = int64(len(desktopBytes))
			}
		}
	})
	directory := t.TempDir()
	manifestPath := filepath.Join(directory, "release.jws.json")
	keyringPath := filepath.Join(directory, "trusted-release-keys.json")
	root := filepath.Join(directory, "state")
	releaseRoot := filepath.Join(root, "releases", "1.0.0-test.1")
	if err := os.MkdirAll(releaseRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, envelope, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyringPath, keyring, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(releaseRoot, "desktop.artifact"), desktopBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := stageDesktop(context.Background(), manifestPath, keyringPath,
		"ubuntu-24.04-lts-x64", root)
	if err != nil {
		t.Fatal(err)
	}
	if result["releaseDirectory"] != releaseRoot {
		t.Fatalf("unexpected release directory: %#v", result)
	}
	if _, err := os.Stat(filepath.Join(releaseRoot, "web.artifact")); !os.IsNotExist(err) {
		t.Fatalf("POS-only staging downloaded a server component: %v", err)
	}
	contents, err := os.ReadFile(filepath.Join(releaseRoot, "install-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state installState
	if err := json.Unmarshal(contents, &state); err != nil {
		t.Fatal(err)
	}
	if !state.CompletedComponents["desktop"] || len(state.CompletedComponents) != 1 {
		t.Fatalf("unexpected staged components: %#v", state.CompletedComponents)
	}
}

func TestServerComponentsExcludeOnlyDesktop(t *testing.T) {
	components := []releaseComponent{
		{Name: "web"}, {Name: "ws"}, {Name: "postgres"}, {Name: "redis"},
		{Name: "runtime"}, {Name: "compose"}, {Name: "desktop"}, {Name: "shop-archetypes"},
	}
	selected := serverComponents(components)
	if len(selected) != len(components)-1 {
		t.Fatalf("unexpected server component count: %d", len(selected))
	}
	for _, component := range selected {
		if component.Name == "desktop" {
			t.Fatal("Server-only staging retained the Desktop component")
		}
	}
}

func TestStageDesktopUsesExplicitLoopbackTestCA(t *testing.T) {
	desktopBytes := []byte(strings.Repeat("desktop-archive-", 128))
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/desktop" {
			http.NotFound(response, request)
			return
		}
		_, _ = response.Write(desktopBytes)
	}))
	defer server.Close()

	digest := sha256.Sum256(desktopBytes)
	envelope, keyring := signedReleaseFixture(t, func(payload *releasePayload) {
		for index := range payload.Components {
			if payload.Components[index].Name == "desktop" {
				payload.Components[index].URL = server.URL + "/desktop"
				payload.Components[index].SHA256 = hex.EncodeToString(digest[:])
				payload.Components[index].SizeBytes = int64(len(desktopBytes))
			}
		}
	})
	directory := t.TempDir()
	manifestPath := filepath.Join(directory, "release.jws.json")
	keyringPath := filepath.Join(directory, "trusted-release-keys.json")
	caPath := filepath.Join(directory, "test-ca.pem")
	if err := os.WriteFile(manifestPath, envelope, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyringPath, keyring, 0o600); err != nil {
		t.Fatal(err)
	}
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	if err := os.WriteFile(caPath, certificate, 0o600); err != nil {
		t.Fatal(err)
	}

	root := filepath.Join(directory, "state")
	if _, err := stageDesktopWithTestCA(context.Background(), manifestPath, keyringPath,
		"ubuntu-24.04-lts-x64", root, caPath); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(root, "releases", "1.0.0-test.1", "desktop.artifact"))
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(desktopBytes) {
		t.Fatal("explicit test CA download changed desktop bytes")
	}
}
