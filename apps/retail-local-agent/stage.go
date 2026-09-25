package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type installState struct {
	FormatVersion       int             `json:"formatVersion"`
	PlatformTarget      string          `json:"platformTarget"`
	ReleaseVersion      string          `json:"releaseVersion"`
	Phase               string          `json:"phase"`
	CompletedComponents map[string]bool `json:"completedComponents"`
	UpdatedAt           string          `json:"updatedAt"`
}

func stageRelease(ctx context.Context, manifestPath, keyringPath, target, root string) (map[string]any, error) {
	verified, err := verifyReleaseFiles(manifestPath, keyringPath, target)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, fmt.Errorf("สร้าง Managed Runtime root ไม่ได้: %w", err)
	}
	releaseRoot := filepath.Join(root, "releases", verified.Payload.ReleaseVersion)
	if err := os.MkdirAll(releaseRoot, 0700); err != nil {
		return nil, err
	}
	unlock, err := acquireInstallLock(root)
	if err != nil {
		return nil, err
	}
	defer unlock()

	// Install/update progress belongs to one immutable release. A global state file made every
	// subsequent version look like a conflicting interrupted install and therefore made the
	// documented updater path impossible.
	statePath := filepath.Join(releaseRoot, "install-state.json")
	state, err := loadOrCreateState(statePath, verified.Payload)
	if err != nil {
		return nil, err
	}
	state.Phase = "downloading"
	if err := writeState(statePath, state); err != nil {
		return nil, err
	}

	client := &http.Client{Transport: &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   20 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if request.URL.Scheme != "https" || request.URL.User != nil {
			return errors.New("ปฏิเสธ redirect ที่ไม่ใช่ HTTPS หรือมี credential")
		}
		if len(via) >= 5 {
			return errors.New("redirect มากเกินไป")
		}
		return nil
	}, Timeout: 0}

	for _, component := range verified.Payload.Components {
		destination := filepath.Join(releaseRoot, safeArtifactName(component.Name))
		if err := downloadComponent(ctx, client, component, destination); err != nil {
			return nil, fmt.Errorf("download %s ไม่สำเร็จ: %w", component.Name, err)
		}
		state.CompletedComponents[component.Name] = true
		state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if err := writeState(statePath, state); err != nil {
			return nil, err
		}
	}
	state.Phase = "staged"
	if err := writeState(statePath, state); err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":               true,
		"phase":            state.Phase,
		"releaseVersion":   state.ReleaseVersion,
		"platformTarget":   state.PlatformTarget,
		"releaseDirectory": releaseRoot,
	}, nil
}

func downloadComponent(ctx context.Context, client *http.Client, component releaseComponent, destination string) error {
	if digest, size, err := fileSHA256(destination); err == nil && digest == component.SHA256 && size == component.SizeBytes {
		return nil
	}
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	partial := destination + ".part"
	file, err := os.OpenFile(partial, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	offset := info.Size()
	if offset == component.SizeBytes {
		digest, size, hashErr := fileSHA256(partial)
		if hashErr == nil && size == component.SizeBytes && digest == component.SHA256 {
			if err := file.Close(); err != nil {
				return err
			}
			if err := os.Rename(partial, destination); err != nil {
				return err
			}
			return syncDirectory(filepath.Dir(destination))
		}
		if err := file.Truncate(0); err != nil {
			return err
		}
		offset = 0
	}
	if offset < 0 || offset > component.SizeBytes {
		if err := file.Truncate(0); err != nil {
			return err
		}
		offset = 0
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, component.URL, nil)
	if err != nil {
		return err
	}
	if offset > 0 {
		request.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK && offset > 0 {
		if err := file.Truncate(0); err != nil {
			return err
		}
		offset = 0
	} else if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if response.StatusCode == http.StatusPartialContent && offset == 0 {
		return errors.New("server ส่ง partial response โดยไม่ได้ร้องขอ")
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return err
	}
	remaining := component.SizeBytes - offset
	written, err := io.Copy(file, io.LimitReader(response.Body, remaining+1))
	if err != nil {
		return err
	}
	if written != remaining {
		return fmt.Errorf("ขนาด download ไม่ตรง: ต้องการ %d ได้ %d", remaining, written)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	digest, size, err := fileSHA256(partial)
	if err != nil {
		return err
	}
	if size != component.SizeBytes || digest != component.SHA256 {
		_ = os.Remove(partial)
		return errors.New("component checksum/size ไม่ตรง")
	}
	if err := os.Rename(partial, destination); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(destination))
}

func loadOrCreateState(path string, payload releasePayload) (installState, error) {
	state := installState{
		FormatVersion: 1, PlatformTarget: payload.PlatformTarget, ReleaseVersion: payload.ReleaseVersion,
		Phase: "verified", CompletedComponents: map[string]bool{}, UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return installState{}, err
	}
	var existing installState
	if err := json.Unmarshal(contents, &existing); err != nil {
		return installState{}, errors.New("install-state.json เสียหาย")
	}
	if existing.FormatVersion != 1 || existing.PlatformTarget != payload.PlatformTarget || existing.ReleaseVersion != payload.ReleaseVersion {
		return installState{}, errors.New("มี installation state ของ release/target อื่น ต้อง recovery ให้เสร็จก่อน")
	}
	if existing.CompletedComponents == nil {
		existing.CompletedComponents = map[string]bool{}
	}
	return existing, nil
}

func writeState(path string, state installState) error {
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	contents, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(contents, '\n'), 0600); err != nil {
		return err
	}
	file, err := os.OpenFile(temporary, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func acquireInstallLock(root string) (func(), error) {
	path := filepath.Join(root, ".install.lock")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		contents, readErr := os.ReadFile(path)
		var pid int
		if readErr == nil {
			_, _ = fmt.Sscanf(string(contents), "pid=%d", &pid)
		}
		if pid > 0 && !processAlive(pid) {
			if removeErr := os.Remove(path); removeErr == nil {
				file, err = os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			}
		}
		if errors.Is(err, os.ErrExist) {
			return nil, errors.New("มี Managed Runtime install/update อื่นกำลังทำงาน")
		}
	}
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(file, "pid=%d\nstarted=%s\n", os.Getpid(), time.Now().UTC().Format(time.RFC3339))
	file.Sync()
	file.Close()
	return func() { _ = os.Remove(path) }, nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func hashBytes(input []byte) string {
	sum := sha256.Sum256(input)
	return hex.EncodeToString(sum[:])
}
