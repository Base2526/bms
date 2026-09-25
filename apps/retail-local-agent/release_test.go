package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"
)

func signedReleaseFixture(t *testing.T, mutate func(*releasePayload)) ([]byte, []byte) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	payload := releasePayload{
		Product: "BMS Retail Local", ReleaseVersion: "1.0.0-test.1", Channel: "pilot",
		PlatformTarget: "ubuntu-24.04-lts-x64", MinimumAgentVersion: "0.1.0", SchemaVersion: "10.15",
		RollbackSafe: false, CreatedAt: time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC).Format(time.RFC3339),
		SourceCommit: strings.Repeat("b", 40),
	}
	for _, name := range []string{"web", "ws", "postgres", "redis"} {
		payload.Components = append(payload.Components, releaseComponent{
			Name: name, Kind: "oci-image", URL: "https://releases.example.invalid/" + name,
			SHA256: digest, OCIDigest: "sha256:" + digest, ImageRef: "bms/" + name + ":1.0.0-test.1", SizeBytes: 1024,
		})
	}
	payload.Components = append(payload.Components,
		releaseComponent{Name: "runtime", Kind: "runtime", URL: "https://releases.example.invalid/runtime", SHA256: digest, SizeBytes: 1024},
		releaseComponent{Name: "compose", Kind: "support-file", URL: "https://releases.example.invalid/compose", SHA256: digest, SizeBytes: 1024},
		releaseComponent{Name: "desktop", Kind: "desktop", URL: "https://releases.example.invalid/desktop", SHA256: digest, SizeBytes: 1024},
	)
	if mutate != nil {
		mutate(&payload)
	}
	headerBytes, _ := json.Marshal(releaseHeader{Algorithm: "EdDSA", KeyID: "test-release-key", Type: "application/vnd.bms.retail-local.release+json"})
	payloadBytes, _ := json.Marshal(payload)
	protectedValue := base64.RawURLEncoding.EncodeToString(headerBytes)
	payloadValue := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signature := ed25519.Sign(privateKey, []byte(protectedValue+"."+payloadValue))
	envelopeBytes, _ := json.Marshal(releaseEnvelope{
		FormatVersion: 1, Protected: protectedValue, Payload: payloadValue,
		Signature: base64.RawURLEncoding.EncodeToString(signature),
	})
	publicBytes, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	keyringBytes, _ := json.Marshal(publicKeyring{FormatVersion: 1, Keys: map[string]string{
		"test-release-key": string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicBytes})),
	}})
	return envelopeBytes, keyringBytes
}

func TestVerifyReleaseAcceptsAuthenticEnvelope(t *testing.T) {
	envelope, keyring := signedReleaseFixture(t, nil)
	verified, err := verifyRelease(envelope, keyring, "ubuntu-24.04-lts-x64")
	if err != nil {
		t.Fatal(err)
	}
	if verified.Payload.ReleaseVersion != "1.0.0-test.1" || verified.Header.KeyID != "test-release-key" {
		t.Fatalf("unexpected verified release: %#v", verified)
	}
}

func TestVerifyReleaseRejectsTamperingAndWrongTarget(t *testing.T) {
	envelope, keyring := signedReleaseFixture(t, nil)
	var parsed releaseEnvelope
	if err := json.Unmarshal(envelope, &parsed); err != nil {
		t.Fatal(err)
	}
	decoded, _ := base64.RawURLEncoding.DecodeString(parsed.Payload)
	var payload releasePayload
	_ = json.Unmarshal(decoded, &payload)
	payload.ReleaseVersion = "9.9.9"
	decoded, _ = json.Marshal(payload)
	parsed.Payload = base64.RawURLEncoding.EncodeToString(decoded)
	tampered, _ := json.Marshal(parsed)
	if _, err := verifyRelease(tampered, keyring, "ubuntu-24.04-lts-x64"); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("expected signature rejection, got %v", err)
	}
	if _, err := verifyRelease(envelope, keyring, "windows-11-x64"); err == nil || !strings.Contains(err.Error(), "target") {
		t.Fatalf("expected target rejection, got %v", err)
	}
}

func TestVerifyReleaseRejectsUnsafeComponentURL(t *testing.T) {
	envelope, keyring := signedReleaseFixture(t, func(payload *releasePayload) {
		payload.Components[0].URL = "https://user:secret@example.invalid/web"
	})
	if _, err := verifyRelease(envelope, keyring, "ubuntu-24.04-lts-x64"); err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("expected URL rejection, got %v", err)
	}
}

func TestAgentVersionCompatibility(t *testing.T) {
	for _, test := range []struct {
		current string
		minimum string
		want    bool
	}{
		{"0.1.0", "0.1.0", true},
		{"0.2.0", "0.1.9", true},
		{"0.1.0", "0.1.1", false},
		{"1.0.0-beta.1", "1.0.0", false},
		{"1.0.0", "1.0.0-beta.1", true},
	} {
		got, err := agentVersionAtLeast(test.current, test.minimum)
		if err != nil || got != test.want {
			t.Fatalf("agentVersionAtLeast(%q,%q)=%v,%v want %v", test.current, test.minimum, got, err, test.want)
		}
	}
}
