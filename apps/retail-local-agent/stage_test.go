package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadComponentResumesAndVerifies(t *testing.T) {
	content := []byte(strings.Repeat("verified-component-", 1024))
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if rangeValue := request.Header.Get("Range"); rangeValue != "" {
			var offset int
			if _, err := fmt.Sscanf(rangeValue, "bytes=%d-", &offset); err != nil {
				t.Fatalf("bad Range: %s", rangeValue)
			}
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
