package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type installationTelemetryInput struct {
	Root, ControlURI, Event, PackageType, PlatformTarget, ReleaseVersion string
	TenantReference, LicenseReference                                    string
	Force                                                                bool
}
type installationTelemetryState struct {
	FormatVersion  int       `json:"formatVersion"`
	InstallationID string    `json:"installationId"`
	Secret         string    `json:"secret"`
	InstalledAt    time.Time `json:"installedAt"`
	LastReportedAt time.Time `json:"lastReportedAt,omitempty"`
	LastMetadata   string    `json:"lastMetadata,omitempty"`
	LastAttemptAt  time.Time `json:"lastAttemptAt,omitempty"`
	LastAttempt    string    `json:"lastAttempt,omitempty"`
}
type installationTelemetryPayload struct {
	FormatVersion    int    `json:"formatVersion"`
	InstallationID   string `json:"installationId"`
	Event            string `json:"event"`
	PackageType      string `json:"packageType"`
	Platform         string `json:"platform"`
	Architecture     string `json:"architecture"`
	OSVersion        string `json:"osVersion"`
	PlatformTarget   string `json:"platformTarget"`
	ReleaseVersion   string `json:"releaseVersion"`
	AgentVersion     string `json:"agentVersion"`
	TenantReference  string `json:"tenantReference,omitempty"`
	LicenseReference string `json:"licenseReference,omitempty"`
	OccurredAt       string `json:"occurredAt"`
}

var installationHTTPClient = func() *http.Client {
	return &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func installationRegistryEndpoint(controlURI string) (string, error) {
	if err := validateEvidenceEndpoint(controlURI); err != nil {
		return "", err
	}
	parsed, err := url.Parse(controlURI)
	if err != nil {
		return "", err
	}
	parsed.Path, parsed.RawQuery, parsed.Fragment = "/api/bms/retail-local/installations", "", ""
	return parsed.String(), nil
}
func installationPlatform() (string, string) {
	platform := map[string]string{"darwin": "macos"}[runtime.GOOS]
	if platform == "" {
		platform = runtime.GOOS
	}
	if platform != "windows" && platform != "linux" && platform != "macos" {
		platform = "unknown"
	}
	architecture := map[string]string{"amd64": "x64", "386": "x86", "arm64": "arm64"}[runtime.GOARCH]
	if architecture == "" {
		architecture = "unknown"
	}
	return platform, architecture
}
func installationOSVersion() string {
	var value string
	switch runtime.GOOS {
	case "linux":
		if data, err := os.ReadFile("/etc/os-release"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(line, "VERSION_ID=") {
					value = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), "\"")
					break
				}
			}
		}
	case "darwin":
		if data, err := exec.Command("sw_vers", "-productVersion").Output(); err == nil {
			value = strings.TrimSpace(string(data))
		}
	case "windows":
		if data, err := exec.Command("cmd.exe", "/d", "/c", "ver").Output(); err == nil {
			value = strings.TrimSpace(string(data))
		}
	}
	value = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
	if len(value) > 128 {
		value = value[:128]
	}
	if value == "" {
		value = "unknown"
	}
	return value
}
func loadOrCreateInstallationTelemetry(root string) (installationTelemetryState, string, error) {
	directory := filepath.Join(root, "installation-telemetry")
	path := filepath.Join(directory, "state.json")
	if data, err := readUIFile(path); err == nil {
		var state installationTelemetryState
		if json.Unmarshal(data, &state) != nil || state.FormatVersion != 1 ||
			!uiRequestPattern.MatchString(state.InstallationID) ||
			!strings.HasPrefix(state.Secret, "bmsit_") || len(state.Secret) != 49 {
			return state, path, errors.New("invalid installation telemetry state")
		}
		return state, path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return installationTelemetryState{}, path, err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return installationTelemetryState{}, path, err
	}
	id, err := randomUUID()
	if err != nil {
		return installationTelemetryState{}, path, err
	}
	secretBytes := make([]byte, 32)
	if _, err = rand.Read(secretBytes); err != nil {
		return installationTelemetryState{}, path, err
	}
	state := installationTelemetryState{FormatVersion: 1, InstallationID: id, Secret: "bmsit_" + base64.RawURLEncoding.EncodeToString(secretBytes), InstalledAt: time.Now().UTC()}
	if err = writeLicenseUIJSON(path, state); err != nil {
		return state, path, err
	}
	return state, path, nil
}
func reportInstallationTelemetry(ctx context.Context, input installationTelemetryInput) error {
	if input.ControlURI == "" {
		return nil
	}
	endpoint, err := installationRegistryEndpoint(input.ControlURI)
	if err != nil {
		return err
	}
	if !map[string]bool{"INSTALLED": true, "SEEN": true, "UPDATED": true, "UNINSTALLED": true}[input.Event] ||
		!map[string]bool{"pos": true, "server": true, "server-pos": true}[input.PackageType] ||
		!licenseFieldPattern.MatchString(input.PlatformTarget) || !licenseFieldPattern.MatchString(input.ReleaseVersion) {
		return errors.New("invalid installation telemetry")
	}
	state, statePath, err := loadOrCreateInstallationTelemetry(input.Root)
	if err != nil {
		return err
	}
	platform, architecture := installationPlatform()
	payload := installationTelemetryPayload{FormatVersion: 1, InstallationID: state.InstallationID, Event: input.Event,
		PackageType: input.PackageType, Platform: platform, Architecture: architecture, OSVersion: installationOSVersion(),
		PlatformTarget: input.PlatformTarget, ReleaseVersion: input.ReleaseVersion, AgentVersion: agentVersion,
		TenantReference: input.TenantReference, LicenseReference: input.LicenseReference, OccurredAt: time.Now().UTC().Format(time.RFC3339)}
	metadata := fmt.Sprintf("%s|%s|%s|%s|%s|%s", input.Event, input.PackageType, input.PlatformTarget, input.ReleaseVersion, input.TenantReference, input.LicenseReference)
	if !input.Force && state.LastMetadata == metadata && time.Since(state.LastReportedAt) < 23*time.Hour {
		return nil
	}
	if !input.Force && state.LastAttempt == metadata && time.Since(state.LastAttemptAt) < 15*time.Minute {
		return nil
	}
	state.LastAttemptAt, state.LastAttempt = time.Now().UTC(), metadata
	if err = writeLicenseUIJSON(statePath, state); err != nil {
		return err
	}
	encoded, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+state.Secret)
	req.Header.Set("Content-Type", "application/json")
	client := installationHTTPClient()
	response, err := client.Do(req)
	if err != nil {
		return errors.New("installation registry unavailable")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("installation registry rejected: %d", response.StatusCode)
	}
	state.LastReportedAt, state.LastMetadata = time.Now().UTC(), metadata
	return writeLicenseUIJSON(statePath, state)
}
