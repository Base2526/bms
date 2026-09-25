package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	licenseEvidenceFormatVersion = 1
	maxLicenseResponseBytes      = 64 * 1024
)

var (
	licenseFieldPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	licenseEventTypes   = map[string]bool{
		"INSTALLATION_REGISTERED":  true,
		"RUNTIME_SEEN":             true,
		"UPDATE_INSTALLED":         true,
		"TRANSFER_REQUESTED":       true,
		"INSTALLATION_DEACTIVATED": true,
	}
)

type licenseEvidenceInput struct {
	Root           string
	EventType      string
	LicenseID      string
	TenantID       string
	POSDeviceID    string
	PlatformTarget string
	ReleaseVersion string
	Endpoint       string
}

type licenseEvidenceEvent struct {
	FormatVersion       int    `json:"formatVersion"`
	EventID             string `json:"eventId"`
	EventType           string `json:"eventType"`
	LicenseID           string `json:"licenseId"`
	InstallationID      string `json:"installationId"`
	TenantID            string `json:"tenantId,omitempty"`
	POSDeviceID         string `json:"posDeviceId,omitempty"`
	PlatformTarget      string `json:"platformTarget"`
	ReleaseVersion      string `json:"releaseVersion"`
	AgentVersion        string `json:"agentVersion"`
	OccurredAt          string `json:"occurredAt"`
	Sequence            uint64 `json:"sequence"`
	PreviousEventHash   string `json:"previousEventHash,omitempty"`
	DeviceKeyThumbprint string `json:"deviceKeyThumbprint"`
}

type licenseEvidenceEnvelope struct {
	FormatVersion   int                  `json:"formatVersion"`
	Event           licenseEvidenceEvent `json:"event"`
	EventHash       string               `json:"eventHash"`
	DevicePublicKey string               `json:"devicePublicKey"`
	Signature       string               `json:"signature"`
}

type licenseEvidenceState struct {
	FormatVersion     int    `json:"formatVersion"`
	InstallationID    string `json:"installationId"`
	Sequence          uint64 `json:"sequence"`
	PreviousEventHash string `json:"previousEventHash,omitempty"`
}

type licenseEvidenceProfile struct {
	FormatVersion    int    `json:"formatVersion"`
	LicenseID        string `json:"licenseId"`
	TenantID         string `json:"tenantId,omitempty"`
	POSDeviceID      string `json:"posDeviceId,omitempty"`
	PlatformTarget   string `json:"platformTarget"`
	ReleaseVersion   string `json:"releaseVersion"`
	EvidenceEndpoint string `json:"evidenceEndpoint,omitempty"`
}

type licenseEvidenceResult struct {
	OK             bool   `json:"ok"`
	Recorded       bool   `json:"recorded"`
	EventID        string `json:"eventId,omitempty"`
	InstallationID string `json:"installationId,omitempty"`
	Delivery       string `json:"delivery"`
	Delivered      int    `json:"delivered"`
	Queued         int    `json:"queued"`
}

func recordLicenseEvidence(ctx context.Context, input licenseEvidenceInput) (licenseEvidenceResult, error) {
	if !licenseEventTypes[input.EventType] {
		return licenseEvidenceResult{}, fmt.Errorf("license event type ไม่รองรับ: %s", input.EventType)
	}
	for name, value := range map[string]string{
		"license-id": input.LicenseID, "target": input.PlatformTarget, "release-version": input.ReleaseVersion,
	} {
		if !licenseFieldPattern.MatchString(value) {
			return licenseEvidenceResult{}, fmt.Errorf("%s ไม่ถูกต้อง", name)
		}
	}
	for name, value := range map[string]string{"tenant-id": input.TenantID, "pos-device-id": input.POSDeviceID} {
		if value != "" && !licenseFieldPattern.MatchString(value) {
			return licenseEvidenceResult{}, fmt.Errorf("%s ไม่ถูกต้อง", name)
		}
	}
	if input.Endpoint != "" {
		if err := validateEvidenceEndpoint(input.Endpoint); err != nil {
			return licenseEvidenceResult{}, err
		}
	}

	evidenceRoot := filepath.Join(input.Root, "license-evidence")
	outboxRoot := filepath.Join(evidenceRoot, "outbox")
	if err := os.MkdirAll(outboxRoot, 0700); err != nil {
		return licenseEvidenceResult{}, fmt.Errorf("สร้าง license evidence directory ไม่ได้: %w", err)
	}
	unlock, err := acquireInstallLock(evidenceRoot)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	defer unlock()
	profile := licenseEvidenceProfile{
		FormatVersion: licenseEvidenceFormatVersion, LicenseID: input.LicenseID, TenantID: input.TenantID,
		POSDeviceID: input.POSDeviceID, PlatformTarget: input.PlatformTarget,
		ReleaseVersion: input.ReleaseVersion, EvidenceEndpoint: input.Endpoint,
	}
	if err := writePrivateJSON(filepath.Join(evidenceRoot, "profile.json"), profile); err != nil {
		return licenseEvidenceResult{}, fmt.Errorf("เขียน license evidence profile ไม่ได้: %w", err)
	}

	privateKey, publicKey, err := loadOrCreateEvidenceKey(filepath.Join(evidenceRoot, "device-key.pem"))
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	statePath := filepath.Join(evidenceRoot, "state.json")
	state, err := loadOrCreateLicenseState(statePath)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	eventID, err := randomUUID()
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	thumbprintBytes := sha256.Sum256(publicKey)
	event := licenseEvidenceEvent{
		FormatVersion: licenseEvidenceFormatVersion, EventID: eventID, EventType: input.EventType,
		LicenseID: input.LicenseID, InstallationID: state.InstallationID, TenantID: input.TenantID,
		POSDeviceID: input.POSDeviceID, PlatformTarget: input.PlatformTarget, ReleaseVersion: input.ReleaseVersion,
		AgentVersion: agentVersion, OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Sequence: state.Sequence + 1,
		PreviousEventHash: state.PreviousEventHash, DeviceKeyThumbprint: hex.EncodeToString(thumbprintBytes[:]),
	}
	eventBytes, err := json.Marshal(event)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	eventHashBytes := sha256.Sum256(eventBytes)
	eventHash := hex.EncodeToString(eventHashBytes[:])
	envelope := licenseEvidenceEnvelope{
		FormatVersion: licenseEvidenceFormatVersion, Event: event, EventHash: eventHash,
		DevicePublicKey: base64.RawURLEncoding.EncodeToString(publicKey),
		Signature:       base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, eventBytes)),
	}
	envelopeBytes, err := json.Marshal(envelope)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	if err := appendSynced(filepath.Join(evidenceRoot, "ledger.jsonl"), append(envelopeBytes, '\n')); err != nil {
		return licenseEvidenceResult{}, fmt.Errorf("เขียน license evidence ledger ไม่ได้: %w", err)
	}
	outboxPath := filepath.Join(outboxRoot, fmt.Sprintf("%020d-%s.json", event.Sequence, event.EventID))
	if err := writePrivateFile(outboxPath, append(envelopeBytes, '\n')); err != nil {
		return licenseEvidenceResult{}, fmt.Errorf("เขียน license evidence outbox ไม่ได้: %w", err)
	}
	state.Sequence = event.Sequence
	state.PreviousEventHash = eventHash
	if err := writePrivateJSON(statePath, state); err != nil {
		return licenseEvidenceResult{}, fmt.Errorf("เขียน license evidence state ไม่ได้: %w", err)
	}

	queued, err := countEvidenceQueue(outboxRoot)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	result := licenseEvidenceResult{OK: true, Recorded: true, EventID: event.EventID, InstallationID: state.InstallationID, Delivery: "local-only", Queued: queued}
	if input.Endpoint != "" {
		flushed, flushErr := flushLicenseEvidenceUnlocked(ctx, outboxRoot, input.Endpoint)
		if flushErr != nil {
			return licenseEvidenceResult{}, flushErr
		}
		result.Delivery, result.Delivered, result.Queued = flushed.Delivery, flushed.Delivered, flushed.Queued
	}
	return result, nil
}

func pulseLicenseEvidence(ctx context.Context, root string) (licenseEvidenceResult, error) {
	profilePath := filepath.Join(root, "license-evidence", "profile.json")
	contents, err := os.ReadFile(profilePath)
	if errors.Is(err, os.ErrNotExist) {
		return licenseEvidenceResult{OK: true, Delivery: "not-configured"}, nil
	}
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	var profile licenseEvidenceProfile
	if err := decodeStrict(contents, &profile); err != nil || profile.FormatVersion != licenseEvidenceFormatVersion {
		return licenseEvidenceResult{}, errors.New("license evidence profile ไม่ถูกต้อง")
	}
	return recordLicenseEvidence(ctx, licenseEvidenceInput{
		Root: root, EventType: "RUNTIME_SEEN", LicenseID: profile.LicenseID, TenantID: profile.TenantID,
		POSDeviceID: profile.POSDeviceID, PlatformTarget: profile.PlatformTarget,
		ReleaseVersion: profile.ReleaseVersion, Endpoint: profile.EvidenceEndpoint,
	})
}

func flushLicenseEvidence(ctx context.Context, root, endpoint string) (licenseEvidenceResult, error) {
	if err := validateEvidenceEndpoint(endpoint); err != nil {
		return licenseEvidenceResult{}, err
	}
	evidenceRoot := filepath.Join(root, "license-evidence")
	if err := os.MkdirAll(filepath.Join(evidenceRoot, "outbox"), 0700); err != nil {
		return licenseEvidenceResult{}, err
	}
	unlock, err := acquireInstallLock(evidenceRoot)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	defer unlock()
	return flushLicenseEvidenceUnlocked(ctx, filepath.Join(evidenceRoot, "outbox"), endpoint)
}

func flushLicenseEvidenceUnlocked(ctx context.Context, outboxRoot, endpoint string) (licenseEvidenceResult, error) {
	entries, err := os.ReadDir(outboxRoot)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	client := &http.Client{Timeout: 8 * time.Second}
	delivered := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(outboxRoot, entry.Name())
		body, readErr := os.ReadFile(path)
		if readErr != nil {
			return licenseEvidenceResult{}, readErr
		}
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if requestErr != nil {
			return licenseEvidenceResult{}, requestErr
		}
		request.Header.Set("Content-Type", "application/vnd.bms.license-evidence+json")
		request.Header.Set("User-Agent", "bms-runtime-agent/"+agentVersion)
		response, sendErr := client.Do(request)
		if sendErr != nil {
			break // Deliberately fail-open: preserve the queue for a later attempt.
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxLicenseResponseBytes))
		response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			break // Back-office rejection is reviewed there; it never blocks the shop.
		}
		if removeErr := os.Remove(path); removeErr != nil {
			return licenseEvidenceResult{}, removeErr
		}
		delivered++
	}
	remaining, err := countEvidenceQueue(outboxRoot)
	if err != nil {
		return licenseEvidenceResult{}, err
	}
	delivery := "delivered"
	if remaining > 0 {
		delivery = "queued"
	}
	return licenseEvidenceResult{OK: true, Delivery: delivery, Delivered: delivered, Queued: remaining}, nil
}

func validateEvidenceEndpoint(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("license evidence endpoint ต้องเป็น HTTPS โดยไม่มี credential/fragment")
	}
	return nil
}

func loadOrCreateEvidenceKey(path string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		publicKey, privateKey, generateErr := ed25519.GenerateKey(rand.Reader)
		if generateErr != nil {
			return nil, nil, generateErr
		}
		encoded, marshalErr := x509.MarshalPKCS8PrivateKey(privateKey)
		if marshalErr != nil {
			return nil, nil, marshalErr
		}
		pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
		if writeErr := writePrivateFile(path, pemBytes); writeErr != nil {
			return nil, nil, writeErr
		}
		return privateKey, publicKey, nil
	}
	if err != nil {
		return nil, nil, err
	}
	block, rest := pem.Decode(contents)
	if block == nil || len(bytes.TrimSpace(rest)) != 0 || block.Type != "PRIVATE KEY" {
		return nil, nil, errors.New("license device key ไม่ถูกต้อง")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, nil, errors.New("license device key อ่านไม่ได้")
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, nil, errors.New("license device key ต้องเป็น Ed25519")
	}
	return privateKey, privateKey.Public().(ed25519.PublicKey), nil
}

func loadOrCreateLicenseState(path string) (licenseEvidenceState, error) {
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		installationID, randomErr := randomUUID()
		if randomErr != nil {
			return licenseEvidenceState{}, randomErr
		}
		return licenseEvidenceState{FormatVersion: licenseEvidenceFormatVersion, InstallationID: installationID}, nil
	}
	if err != nil {
		return licenseEvidenceState{}, err
	}
	var state licenseEvidenceState
	if err := decodeStrict(contents, &state); err != nil || state.FormatVersion != licenseEvidenceFormatVersion || state.InstallationID == "" {
		return licenseEvidenceState{}, errors.New("license evidence state ไม่ถูกต้อง")
	}
	return state, nil
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func appendSynced(path string, contents []byte) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	if _, err := file.Write(contents); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func writePrivateFile(path string, contents []byte) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, contents, 0600); err != nil {
		return err
	}
	if err := os.Chmod(temporary, 0600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func writePrivateJSON(path string, value any) error {
	contents, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(path, append(contents, '\n'))
}

func countEvidenceQueue(path string) (int, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			count++
		}
	}
	return count, nil
}
