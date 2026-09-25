package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLicenseEvidenceIsSignedAndHashChained(t *testing.T) {
	root := t.TempDir()
	input := licenseEvidenceInput{
		Root: root, EventType: "INSTALLATION_REGISTERED", LicenseID: "lic-test-1",
		TenantID: "11111111-1111-4111-8111-111111111111", POSDeviceID: "22222222-2222-4222-8222-222222222222",
		PlatformTarget: "ubuntu-24.04-lts-x64", ReleaseVersion: "0.2.0-test.1",
	}
	first, err := recordLicenseEvidence(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	input.EventType = "RUNTIME_SEEN"
	second, err := recordLicenseEvidence(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if first.InstallationID == "" || first.InstallationID != second.InstallationID || second.Queued != 2 {
		t.Fatalf("unexpected evidence result: first=%+v second=%+v", first, second)
	}

	ledger, err := os.ReadFile(filepath.Join(root, "license-evidence", "ledger.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(ledger)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 ledger lines, got %d", len(lines))
	}
	var envelopes [2]licenseEvidenceEnvelope
	for index, line := range lines {
		if err := json.Unmarshal([]byte(line), &envelopes[index]); err != nil {
			t.Fatal(err)
		}
		eventBytes, err := json.Marshal(envelopes[index].Event)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(eventBytes)
		if envelopes[index].EventHash != hex.EncodeToString(digest[:]) {
			t.Fatal("event hash does not match canonical event")
		}
		publicKey, err := base64.RawURLEncoding.DecodeString(envelopes[index].DevicePublicKey)
		if err != nil {
			t.Fatal(err)
		}
		signature, err := base64.RawURLEncoding.DecodeString(envelopes[index].Signature)
		if err != nil {
			t.Fatal(err)
		}
		if !ed25519.Verify(ed25519.PublicKey(publicKey), eventBytes, signature) {
			t.Fatal("event signature is invalid")
		}
	}
	if envelopes[0].Event.Sequence != 1 || envelopes[1].Event.Sequence != 2 ||
		envelopes[1].Event.PreviousEventHash != envelopes[0].EventHash {
		t.Fatal("event chain is not continuous")
	}
}

func TestLicenseEvidenceDeliveryFailureQueuesWithoutBlocking(t *testing.T) {
	root := t.TempDir()
	result, err := recordLicenseEvidence(t.Context(), licenseEvidenceInput{
		Root: root, EventType: "RUNTIME_SEEN", LicenseID: "lic-test-1",
		PlatformTarget: "windows-11-x64", ReleaseVersion: "0.2.0",
		Endpoint: "https://127.0.0.1:1/v1/license-evidence",
	})
	if err != nil {
		t.Fatalf("network failure must be fail-open, got %v", err)
	}
	if !result.OK || !result.Recorded || result.Delivery != "queued" || result.Queued != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestLicensePulseUsesPersistedProfileAndMissingProfileIsNoop(t *testing.T) {
	root := t.TempDir()
	missing, err := pulseLicenseEvidence(t.Context(), root)
	if err != nil || !missing.OK || missing.Delivery != "not-configured" {
		t.Fatalf("missing profile must be a harmless no-op: result=%+v err=%v", missing, err)
	}
	_, err = recordLicenseEvidence(t.Context(), licenseEvidenceInput{
		Root: root, EventType: "INSTALLATION_REGISTERED", LicenseID: "lic-test-2",
		PlatformTarget: "ubuntu-24.04-lts-x64", ReleaseVersion: "0.2.0",
	})
	if err != nil {
		t.Fatal(err)
	}
	pulse, err := pulseLicenseEvidence(t.Context(), root)
	if err != nil || !pulse.OK || pulse.Queued != 2 {
		t.Fatalf("unexpected pulse: result=%+v err=%v", pulse, err)
	}
}

func TestLicenseEvidenceRejectsUnsafeIdentifiersAndEndpoints(t *testing.T) {
	root := t.TempDir()
	_, err := recordLicenseEvidence(t.Context(), licenseEvidenceInput{
		Root: root, EventType: "RUNTIME_SEEN", LicenseID: "secret\nheader", PlatformTarget: "x", ReleaseVersion: "1",
	})
	if err == nil {
		t.Fatal("expected unsafe license id to be rejected")
	}
	_, err = recordLicenseEvidence(t.Context(), licenseEvidenceInput{
		Root: root, EventType: "RUNTIME_SEEN", LicenseID: "lic-1", PlatformTarget: "x", ReleaseVersion: "1",
		Endpoint: "http://user:pass@example.test/events",
	})
	if err == nil {
		t.Fatal("expected insecure endpoint to be rejected")
	}
}
