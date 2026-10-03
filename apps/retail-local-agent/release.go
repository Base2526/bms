package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const maxEnvelopeBytes = 1024 * 1024

var (
	versionPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	targetPattern    = regexp.MustCompile(`^[a-z0-9._-]{1,80}$`)
	componentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	hexPattern       = regexp.MustCompile(`^[a-f0-9]{64}$`)
	digestPattern    = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	imageRefPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$`)
	commitPattern    = regexp.MustCompile(`^[a-f0-9]{40}$`)
	semverPattern    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?$`)
)

type releaseEnvelope struct {
	FormatVersion int    `json:"formatVersion"`
	Protected     string `json:"protected"`
	Payload       string `json:"payload"`
	Signature     string `json:"signature"`
}

type releaseHeader struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
	Type      string `json:"typ"`
}

type releasePayload struct {
	Product             string             `json:"product"`
	ReleaseVersion      string             `json:"releaseVersion"`
	Channel             string             `json:"channel"`
	PlatformTarget      string             `json:"platformTarget"`
	MinimumAgentVersion string             `json:"minimumAgentVersion"`
	SchemaVersion       string             `json:"schemaVersion"`
	RollbackSafe        bool               `json:"rollbackSafe"`
	CreatedAt           string             `json:"createdAt"`
	SourceCommit        string             `json:"sourceCommit"`
	Components          []releaseComponent `json:"components"`
}

type releaseComponent struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	OCIDigest string `json:"ociDigest,omitempty"`
	ImageRef  string `json:"imageRef,omitempty"`
	SizeBytes int64  `json:"sizeBytes"`
}

type publicKeyring struct {
	FormatVersion int               `json:"formatVersion"`
	Keys          map[string]string `json:"keys"`
}

type verifiedRelease struct {
	Header  releaseHeader
	Payload releasePayload
}

func verifyReleaseFiles(manifestPath, keyringPath, expectedTarget string) (verifiedRelease, error) {
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		return verifiedRelease{}, fmt.Errorf("Could not read release manifest: %w", err)
	}
	keys, err := os.ReadFile(keyringPath)
	if err != nil {
		return verifiedRelease{}, fmt.Errorf("Could not read trusted keyring: %w", err)
	}
	return verifyRelease(manifest, keys, expectedTarget)
}

func verifyRelease(envelopeBytes, keyringBytes []byte, expectedTarget string) (verifiedRelease, error) {
	if len(envelopeBytes) == 0 || len(envelopeBytes) > maxEnvelopeBytes {
		return verifiedRelease{}, errors.New("Invalid release envelope size")
	}
	var envelope releaseEnvelope
	if err := decodeStrict(envelopeBytes, &envelope); err != nil {
		return verifiedRelease{}, fmt.Errorf("Invalid release envelope: %w", err)
	}
	if envelope.FormatVersion != 1 {
		return verifiedRelease{}, errors.New("Unsupported release envelope version")
	}
	protectedBytes, err := decodeBase64URL(envelope.Protected, "protected")
	if err != nil {
		return verifiedRelease{}, err
	}
	payloadBytes, err := decodeBase64URL(envelope.Payload, "payload")
	if err != nil {
		return verifiedRelease{}, err
	}
	signature, err := decodeBase64URL(envelope.Signature, "signature")
	if err != nil {
		return verifiedRelease{}, err
	}
	if len(signature) != ed25519.SignatureSize {
		return verifiedRelease{}, errors.New("Ed25519 signature must be 64 bytes")
	}

	var header releaseHeader
	if err := decodeStrict(protectedBytes, &header); err != nil {
		return verifiedRelease{}, fmt.Errorf("Invalid protected header: %w", err)
	}
	if header.Algorithm != "EdDSA" || header.Type != "application/vnd.bms.retail-local.release+json" || !versionPattern.MatchString(header.KeyID) {
		return verifiedRelease{}, errors.New("Protected header does not match the BMS release contract")
	}

	var keyring publicKeyring
	if err := decodeStrict(keyringBytes, &keyring); err != nil || keyring.FormatVersion != 1 {
		return verifiedRelease{}, errors.New("Invalid trusted keyring")
	}
	publicKeyPEM, ok := keyring.Keys[header.KeyID]
	if !ok {
		return verifiedRelease{}, fmt.Errorf("Untrusted release key ID %q", header.KeyID)
	}
	publicKey, err := parseEd25519PublicKey(publicKeyPEM)
	if err != nil {
		return verifiedRelease{}, err
	}
	signingInput := []byte(envelope.Protected + "." + envelope.Payload)
	if !ed25519.Verify(publicKey, signingInput, signature) {
		return verifiedRelease{}, errors.New("Invalid release signature")
	}

	// Interpret URLs and component metadata only after publisher authentication.
	var payload releasePayload
	if err := decodeStrict(payloadBytes, &payload); err != nil {
		return verifiedRelease{}, fmt.Errorf("Invalid release payload: %w", err)
	}
	if err := validatePayload(payload, expectedTarget); err != nil {
		return verifiedRelease{}, err
	}
	return verifiedRelease{Header: header, Payload: payload}, nil
}

func decodeStrict(input []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("Unexpected data after JSON")
	}
	return nil
}

func decodeBase64URL(input, name string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(input)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != input {
		return nil, fmt.Errorf("%s is not canonical base64url", name)
	}
	return decoded, nil
}

func parseEd25519PublicKey(input string) (ed25519.PublicKey, error) {
	block, rest := pem.Decode([]byte(input))
	if block == nil || len(bytes.TrimSpace(rest)) != 0 || block.Type != "PUBLIC KEY" {
		return nil, errors.New("Invalid release public key PEM")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, errors.New("Could not parse release public key")
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("Release public key must be Ed25519")
	}
	return key, nil
}

func validatePayload(payload releasePayload, expectedTarget string) error {
	if payload.Product != "BMS Retail Local" || !semverPattern.MatchString(payload.ReleaseVersion) {
		return errors.New("Invalid release product or version")
	}
	if payload.Channel != "pilot" && payload.Channel != "stable" {
		return errors.New("Invalid release channel")
	}
	if !targetPattern.MatchString(payload.PlatformTarget) || payload.PlatformTarget != expectedTarget {
		return fmt.Errorf("Release target does not match this computer: %s", payload.PlatformTarget)
	}
	if !versionPattern.MatchString(payload.MinimumAgentVersion) || payload.SchemaVersion == "" || len(payload.SchemaVersion) > 64 {
		return errors.New("Invalid release agent or schema version")
	}
	compatible, err := agentVersionAtLeast(agentVersion, payload.MinimumAgentVersion)
	if err != nil || !compatible {
		return fmt.Errorf("Release requires agent %s; installed agent is %s", payload.MinimumAgentVersion, agentVersion)
	}
	if _, err := time.Parse(time.RFC3339, payload.CreatedAt); err != nil || !commitPattern.MatchString(payload.SourceCommit) {
		return errors.New("Invalid release provenance")
	}
	if len(payload.Components) < 7 {
		return errors.New("Incomplete release components")
	}
	required := map[string]bool{"web": false, "ws": false, "postgres": false, "redis": false, "runtime": false, "compose": false, "desktop": false}
	requiredKinds := map[string]string{"web": "oci-image", "ws": "oci-image", "postgres": "oci-image", "redis": "oci-image", "runtime": "runtime", "compose": "support-file", "desktop": "desktop"}
	seen := make(map[string]bool, len(payload.Components))
	for index, component := range payload.Components {
		if err := validateComponent(component); err != nil {
			return fmt.Errorf("components[%d]: %w", index, err)
		}
		if seen[component.Name] {
			return fmt.Errorf("Duplicate release component name: %s", component.Name)
		}
		seen[component.Name] = true
		if _, ok := required[component.Name]; ok {
			if component.Kind != requiredKinds[component.Name] {
				return fmt.Errorf("Component %s must have kind %s", component.Name, requiredKinds[component.Name])
			}
			required[component.Name] = true
		}
	}
	for name, present := range required {
		if !present {
			return fmt.Errorf("Release is missing component %s", name)
		}
	}
	return nil
}

func compareSemver(left, right string) (int, error) {
	leftParts := semverPattern.FindStringSubmatch(left)
	rightParts := semverPattern.FindStringSubmatch(right)
	if leftParts == nil || rightParts == nil {
		return 0, errors.New("Release version is not a semantic version")
	}
	for index := 1; index <= 3; index++ {
		var leftNumber, rightNumber int
		if _, err := fmt.Sscan(leftParts[index], &leftNumber); err != nil {
			return 0, err
		}
		if _, err := fmt.Sscan(rightParts[index], &rightNumber); err != nil {
			return 0, err
		}
		if leftNumber < rightNumber {
			return -1, nil
		}
		if leftNumber > rightNumber {
			return 1, nil
		}
	}
	leftDash := strings.IndexByte(left, '-')
	rightDash := strings.IndexByte(right, '-')
	if leftDash < 0 && rightDash < 0 {
		return 0, nil
	}
	if leftDash < 0 {
		return 1, nil
	}
	if rightDash < 0 {
		return -1, nil
	}
	leftPre := strings.Split(left[leftDash+1:], ".")
	rightPre := strings.Split(right[rightDash+1:], ".")
	for index := 0; index < len(leftPre) && index < len(rightPre); index++ {
		if leftPre[index] == rightPre[index] {
			continue
		}
		var leftNumber, rightNumber int
		_, leftNumericErr := fmt.Sscan(leftPre[index], &leftNumber)
		_, rightNumericErr := fmt.Sscan(rightPre[index], &rightNumber)
		leftNumeric := leftNumericErr == nil && fmt.Sprint(leftNumber) == leftPre[index]
		rightNumeric := rightNumericErr == nil && fmt.Sprint(rightNumber) == rightPre[index]
		if leftNumeric && rightNumeric {
			if leftNumber < rightNumber {
				return -1, nil
			}
			return 1, nil
		}
		if leftNumeric != rightNumeric {
			if leftNumeric {
				return -1, nil
			}
			return 1, nil
		}
		if leftPre[index] < rightPre[index] {
			return -1, nil
		}
		return 1, nil
	}
	if len(leftPre) < len(rightPre) {
		return -1, nil
	}
	if len(leftPre) > len(rightPre) {
		return 1, nil
	}
	return 0, nil
}

func agentVersionAtLeast(current, minimum string) (bool, error) {
	currentParts := semverPattern.FindStringSubmatch(current)
	minimumParts := semverPattern.FindStringSubmatch(minimum)
	if currentParts == nil || minimumParts == nil {
		return false, errors.New("Agent version is not a semantic version")
	}
	for index := 1; index <= 3; index++ {
		var currentNumber, minimumNumber int
		if _, err := fmt.Sscan(currentParts[index], &currentNumber); err != nil {
			return false, err
		}
		if _, err := fmt.Sscan(minimumParts[index], &minimumNumber); err != nil {
			return false, err
		}
		if currentNumber != minimumNumber {
			return currentNumber > minimumNumber, nil
		}
	}
	currentPre := strings.Contains(current, "-")
	minimumPre := strings.Contains(minimum, "-")
	if currentPre && !minimumPre {
		return false, nil
	}
	if currentPre && minimumPre {
		return current == minimum, nil
	}
	return true, nil
}

func validateComponent(component releaseComponent) error {
	if !componentPattern.MatchString(component.Name) {
		return errors.New("Invalid name")
	}
	if component.Kind != "oci-image" && component.Kind != "runtime" && component.Kind != "desktop" && component.Kind != "support-file" {
		return errors.New("Invalid kind")
	}
	parsedURL, err := url.Parse(component.URL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.User != nil || parsedURL.Fragment != "" {
		return errors.New("URL must use HTTPS without credentials or a fragment")
	}
	if !hexPattern.MatchString(component.SHA256) || component.SizeBytes <= 0 {
		return errors.New("Invalid SHA-256 or size")
	}
	if component.Kind == "oci-image" {
		if !digestPattern.MatchString(component.OCIDigest) {
			return errors.New("Missing immutable OCI digest")
		}
		if !imageRefPattern.MatchString(component.ImageRef) {
			return errors.New("Missing imageRef")
		}
	}
	return nil
}

func fileSHA256(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}

func safeArtifactName(name string) string {
	return strings.ReplaceAll(name, ".", "-") + ".artifact"
}
