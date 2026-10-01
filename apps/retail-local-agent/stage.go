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
	"sync/atomic"
	"time"
)

const downloadMaxAttempts = 5

var (
	downloadIdleTimeout      = 45 * time.Second
	downloadProgressInterval = 500 * time.Millisecond
)

var errDownloadIdle = errors.New("download ไม่มีข้อมูลใหม่เกินเวลาที่กำหนด")

type downloadProgressWriter struct {
	w        io.Writer
	written  atomic.Int64
	activity chan<- struct{}
}

func (writer *downloadProgressWriter) Write(buffer []byte) (int, error) {
	written, err := writer.w.Write(buffer)
	writer.written.Add(int64(written))
	select {
	case writer.activity <- struct{}{}:
	default:
	}
	return written, err
}

type installState struct {
	FormatVersion       int             `json:"formatVersion"`
	PlatformTarget      string          `json:"platformTarget"`
	ReleaseVersion      string          `json:"releaseVersion"`
	Phase               string          `json:"phase"`
	CompletedComponents map[string]bool `json:"completedComponents"`
	UpdatedAt           string          `json:"updatedAt"`
}

func stageRelease(ctx context.Context, manifestPath, keyringPath, target, root string, reporters ...progressReporter) (map[string]any, error) {
	verified, err := verifyReleaseFiles(manifestPath, keyringPath, target)
	if err != nil {
		return nil, err
	}
	return stageVerifiedComponents(ctx, verified, root, verified.Payload.Components, reporters...)
}

// stageDesktop verifies the complete publisher-signed release contract before selecting the one
// desktop component. Keeping the selection inside the agent prevents a bootstrap shell script from
// treating an untrusted URL or checksum as authority while allowing the POS-only installer to stay
// small and download Electron only on first install.
func stageDesktop(ctx context.Context, manifestPath, keyringPath, target, root string, reporters ...progressReporter) (map[string]any, error) {
	verified, err := verifyReleaseFiles(manifestPath, keyringPath, target)
	if err != nil {
		return nil, err
	}
	var desktop []releaseComponent
	for _, component := range verified.Payload.Components {
		if component.Name == "desktop" {
			if component.Kind != "desktop" {
				return nil, errors.New("signed release desktop component มี kind ไม่ถูกต้อง")
			}
			desktop = append(desktop, component)
		}
	}
	if len(desktop) != 1 {
		return nil, errors.New("signed release ต้องมี desktop component หนึ่งรายการ")
	}
	return stageVerifiedComponents(ctx, verified, root, desktop, reporters...)
}

func stageVerifiedComponents(ctx context.Context, verified verifiedRelease, root string, components []releaseComponent,
	reporters ...progressReporter) (map[string]any, error) {
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

	var totalBytes int64
	for _, component := range components {
		totalBytes += component.SizeBytes
	}
	var completedBytes int64
	for _, component := range components {
		destination := filepath.Join(releaseRoot, safeArtifactName(component.Name))
		if err := downloadComponent(ctx, client, component, destination, completedBytes, totalBytes, reporters...); err != nil {
			return nil, fmt.Errorf("download %s ไม่สำเร็จ: %w", component.Name, err)
		}
		completedBytes += component.SizeBytes
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
	reportProgress(reporters, progressEvent{Phase: "staged", CompletedBytes: totalBytes, TotalBytes: totalBytes})
	return map[string]any{
		"ok":               true,
		"phase":            state.Phase,
		"releaseVersion":   state.ReleaseVersion,
		"platformTarget":   state.PlatformTarget,
		"releaseDirectory": releaseRoot,
	}, nil
}

func downloadComponent(ctx context.Context, client *http.Client, component releaseComponent, destination string,
	completedBefore, totalBytes int64, reporters ...progressReporter) error {
	if digest, size, err := fileSHA256(destination); err == nil && digest == component.SHA256 && size == component.SizeBytes {
		reportProgress(reporters, progressEvent{Phase: "cached", Component: component.Name,
			CompletedBytes: completedBefore + component.SizeBytes, TotalBytes: totalBytes})
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
		reportProgress(reporters, progressEvent{Phase: "verify", Component: component.Name,
			CompletedBytes: completedBefore + offset, TotalBytes: totalBytes})
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

	var lastDownloadErr error
	downloadComplete := false
	for attempt := 1; attempt <= downloadMaxAttempts; attempt++ {
		info, statErr := file.Stat()
		if statErr != nil {
			return statErr
		}
		offset = info.Size()
		if offset < 0 || offset > component.SizeBytes {
			if err := file.Truncate(0); err != nil {
				return err
			}
			offset = 0
		}

		reportProgress(reporters, progressEvent{
			Phase: "connect", Component: component.Name, Attempt: attempt,
			CompletedBytes: completedBefore + offset, TotalBytes: totalBytes,
			ComponentCompletedBytes: offset, ComponentTotalBytes: component.SizeBytes, Heartbeat: true,
		})
		attemptContext, cancelAttempt := context.WithCancel(ctx)
		request, requestErr := http.NewRequestWithContext(attemptContext, http.MethodGet, component.URL, nil)
		if requestErr != nil {
			cancelAttempt()
			return requestErr
		}
		if offset > 0 {
			request.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
		}
		response, requestErr := client.Do(request)
		if requestErr != nil {
			cancelAttempt()
			lastDownloadErr = requestErr
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := waitBeforeDownloadRetry(ctx, reporters, component, completedBefore, totalBytes, offset, attempt); err != nil {
				return err
			}
			continue
		}

		if response.StatusCode == http.StatusOK && offset > 0 {
			if err := file.Truncate(0); err != nil {
				response.Body.Close()
				cancelAttempt()
				return err
			}
			offset = 0
		} else if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
			response.Body.Close()
			cancelAttempt()
			lastDownloadErr = fmt.Errorf("HTTP %d", response.StatusCode)
			if err := waitBeforeDownloadRetry(ctx, reporters, component, completedBefore, totalBytes, offset, attempt); err != nil {
				return err
			}
			continue
		}
		if response.StatusCode == http.StatusPartialContent && offset == 0 {
			response.Body.Close()
			cancelAttempt()
			return errors.New("server ส่ง partial response โดยไม่ได้ร้องขอ")
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			response.Body.Close()
			cancelAttempt()
			return err
		}

		remaining := component.SizeBytes - offset
		written, copyErr := copyDownloadBody(attemptContext, cancelAttempt, response.Body, file,
			component, completedBefore, totalBytes, offset, remaining, attempt, reporters...)
		response.Body.Close()
		cancelAttempt()
		if copyErr == nil && written == remaining {
			downloadComplete = true
			break
		}
		if copyErr == nil {
			copyErr = io.ErrUnexpectedEOF
		}
		lastDownloadErr = copyErr
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := file.Sync(); err != nil {
			return err
		}
		current, statErr := file.Stat()
		if statErr != nil {
			return statErr
		}
		if current.Size() > component.SizeBytes {
			return fmt.Errorf("ขนาด download เกิน manifest: ต้องการ %d ได้ %d", component.SizeBytes, current.Size())
		}
		if err := waitBeforeDownloadRetry(ctx, reporters, component, completedBefore, totalBytes,
			current.Size(), attempt); err != nil {
			return err
		}
	}
	if !downloadComplete {
		return fmt.Errorf("download ล้มเหลวหลังลอง %d ครั้ง: %w", downloadMaxAttempts, lastDownloadErr)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	reportProgress(reporters, progressEvent{Phase: "verify", Component: component.Name,
		CompletedBytes: completedBefore + component.SizeBytes, TotalBytes: totalBytes})
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

func copyDownloadBody(ctx context.Context, cancel context.CancelFunc, body io.ReadCloser, destination io.Writer,
	component releaseComponent, completedBefore, totalBytes, offset, remaining int64, attempt int,
	reporters ...progressReporter) (int64, error) {
	activity := make(chan struct{}, 1)
	writer := &downloadProgressWriter{w: destination, activity: activity}
	type copyResult struct {
		written int64
		err     error
	}
	result := make(chan copyResult, 1)
	go func() {
		written, err := io.Copy(writer, io.LimitReader(body, remaining+1))
		result <- copyResult{written: written, err: err}
	}()

	progressTicker := time.NewTicker(downloadProgressInterval)
	defer progressTicker.Stop()
	idleTimer := time.NewTimer(downloadIdleTimeout)
	defer idleTimer.Stop()
	resetIdle := func() {
		if !idleTimer.Stop() {
			select {
			case <-idleTimer.C:
			default:
			}
		}
		idleTimer.Reset(downloadIdleTimeout)
	}
	lastReported := int64(-1)
	report := func(heartbeat bool) {
		attemptWritten := writer.written.Load()
		componentCompleted := offset + attemptWritten
		reportProgress(reporters, progressEvent{
			Phase: "download", Component: component.Name, Attempt: attempt, Heartbeat: heartbeat,
			CompletedBytes: completedBefore + componentCompleted, TotalBytes: totalBytes,
			ComponentCompletedBytes: componentCompleted, ComponentTotalBytes: component.SizeBytes,
		})
		lastReported = attemptWritten
	}
	report(false)

	for {
		select {
		case copy := <-result:
			report(false)
			return copy.written, copy.err
		case <-activity:
			resetIdle()
		case <-progressTicker.C:
			current := writer.written.Load()
			report(current == lastReported)
		case <-idleTimer.C:
			cancel()
			_ = body.Close()
			select {
			case <-result:
			case <-time.After(5 * time.Second):
			}
			return writer.written.Load(), errDownloadIdle
		case <-ctx.Done():
			_ = body.Close()
			select {
			case <-result:
			case <-time.After(5 * time.Second):
			}
			return writer.written.Load(), ctx.Err()
		}
	}
}

func waitBeforeDownloadRetry(ctx context.Context, reporters []progressReporter, component releaseComponent,
	completedBefore, totalBytes, componentCompleted int64, attempt int) error {
	if attempt >= downloadMaxAttempts {
		return nil
	}
	retryAfter := 1 << (attempt - 1)
	reportProgress(reporters, progressEvent{
		Phase: "retry", Component: component.Name, Attempt: attempt, RetryAfterSeconds: retryAfter,
		CompletedBytes: completedBefore + componentCompleted, TotalBytes: totalBytes,
		ComponentCompletedBytes: componentCompleted, ComponentTotalBytes: component.SizeBytes,
	})
	timer := time.NewTimer(time.Duration(retryAfter) * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
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

func hashBytes(input []byte) string {
	sum := sha256.Sum256(input)
	return hex.EncodeToString(sum[:])
}
