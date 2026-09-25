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
		return verifiedRelease{}, fmt.Errorf("อ่าน release manifest ไม่ได้: %w", err)
	}
	keys, err := os.ReadFile(keyringPath)
	if err != nil {
		return verifiedRelease{}, fmt.Errorf("อ่าน trusted keyring ไม่ได้: %w", err)
	}
	return verifyRelease(manifest, keys, expectedTarget)
}

func verifyRelease(envelopeBytes, keyringBytes []byte, expectedTarget string) (verifiedRelease, error) {
	if len(envelopeBytes) == 0 || len(envelopeBytes) > maxEnvelopeBytes {
		return verifiedRelease{}, errors.New("release envelope มีขนาดไม่ถูกต้อง")
	}
	var envelope releaseEnvelope
	if err := decodeStrict(envelopeBytes, &envelope); err != nil {
		return verifiedRelease{}, fmt.Errorf("release envelope ไม่ถูกต้อง: %w", err)
	}
	if envelope.FormatVersion != 1 {
		return verifiedRelease{}, errors.New("release envelope version ไม่รองรับ")
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
		return verifiedRelease{}, errors.New("Ed25519 signature ต้องยาว 64 bytes")
	}

	var header releaseHeader
	if err := decodeStrict(protectedBytes, &header); err != nil {
		return verifiedRelease{}, fmt.Errorf("protected header ไม่ถูกต้อง: %w", err)
	}
	if header.Algorithm != "EdDSA" || header.Type != "application/vnd.bms.retail-local.release+json" || !versionPattern.MatchString(header.KeyID) {
		return verifiedRelease{}, errors.New("protected header ไม่อยู่ใน BMS release contract")
	}

	var keyring publicKeyring
	if err := decodeStrict(keyringBytes, &keyring); err != nil || keyring.FormatVersion != 1 {
		return verifiedRelease{}, errors.New("trusted keyring ไม่ถูกต้อง")
	}
	publicKeyPEM, ok := keyring.Keys[header.KeyID]
	if !ok {
		return verifiedRelease{}, fmt.Errorf("ไม่เชื่อถือ release key id %q", header.KeyID)
	}
	publicKey, err := parseEd25519PublicKey(publicKeyPEM)
	if err != nil {
		return verifiedRelease{}, err
	}
	signingInput := []byte(envelope.Protected + "." + envelope.Payload)
	if !ed25519.Verify(publicKey, signingInput, signature) {
		return verifiedRelease{}, errors.New("release signature ไม่ถูกต้อง")
	}

	// Interpret URLs and component metadata only after publisher authentication.
	var payload releasePayload
	if err := decodeStrict(payloadBytes, &payload); err != nil {
		return verifiedRelease{}, fmt.Errorf("release payload ไม่ถูกต้อง: %w", err)
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
		return errors.New("พบข้อมูลต่อท้าย JSON")
	}
	return nil
}

func decodeBase64URL(input, name string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(input)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != input {
		return nil, fmt.Errorf("%s ไม่ใช่ canonical base64url", name)
	}
	return decoded, nil
}

func parseEd25519PublicKey(input string) (ed25519.PublicKey, error) {
	block, rest := pem.Decode([]byte(input))
	if block == nil || len(bytes.TrimSpace(rest)) != 0 || block.Type != "PUBLIC KEY" {
		return nil, errors.New("release public key PEM ไม่ถูกต้อง")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, errors.New("release public key อ่านไม่ได้")
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("release public key ต้องเป็น Ed25519")
	}
	return key, nil
}

func validatePayload(payload releasePayload, expectedTarget string) error {
	if payload.Product != "BMS Retail Local" || !semverPattern.MatchString(payload.ReleaseVersion) {
		return errors.New("release product/version ไม่ถูกต้อง")
	}
	if payload.Channel != "pilot" && payload.Channel != "stable" {
		return errors.New("release channel ไม่ถูกต้อง")
	}
	if !targetPattern.MatchString(payload.PlatformTarget) || payload.PlatformTarget != expectedTarget {
		return fmt.Errorf("release target ไม่ตรงกับเครื่อง: %s", payload.PlatformTarget)
	}
	if !versionPattern.MatchString(payload.MinimumAgentVersion) || payload.SchemaVersion == "" || len(payload.SchemaVersion) > 64 {
		return errors.New("release agent/schema version ไม่ถูกต้อง")
	}
	compatible, err := agentVersionAtLeast(agentVersion, payload.MinimumAgentVersion)
	if err != nil || !compatible {
		return fmt.Errorf("release ต้องการ agent %s แต่เครื่องมี %s", payload.MinimumAgentVersion, agentVersion)
	}
	if _, err := time.Parse(time.RFC3339, payload.CreatedAt); err != nil || !commitPattern.MatchString(payload.SourceCommit) {
		return errors.New("release provenance ไม่ถูกต้อง")
	}
	if len(payload.Components) < 7 {
		return errors.New("release components ไม่ครบ")
	}
	required := map[string]bool{"web": false, "ws": false, "postgres": false, "redis": false, "runtime": false, "compose": false, "desktop": false}
	requiredKinds := map[string]string{"web": "oci-image", "ws": "oci-image", "postgres": "oci-image", "redis": "oci-image", "runtime": "runtime", "compose": "support-file", "desktop": "desktop"}
	seen := make(map[string]bool, len(payload.Components))
	for index, component := range payload.Components {
		if err := validateComponent(component); err != nil {
			return fmt.Errorf("components[%d]: %w", index, err)
		}
		if seen[component.Name] {
			return fmt.Errorf("release มี component name ซ้ำ: %s", component.Name)
		}
		seen[component.Name] = true
		if _, ok := required[component.Name]; ok {
			if component.Kind != requiredKinds[component.Name] {
				return fmt.Errorf("component %s ต้องเป็น kind %s", component.Name, requiredKinds[component.Name])
			}
			required[component.Name] = true
		}
	}
	for name, present := range required {
		if !present {
			return fmt.Errorf("release ขาด component %s", name)
		}
	}
	return nil
}

func compareSemver(left, right string) (int, error) {
	leftParts := semverPattern.FindStringSubmatch(left)
	rightParts := semverPattern.FindStringSubmatch(right)
	if leftParts == nil || rightParts == nil {
		return 0, errors.New("release version ไม่ใช่ semantic version")
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
		return false, errors.New("agent version ไม่ใช่ semantic version")
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
		return errors.New("name ไม่ถูกต้อง")
	}
	if component.Kind != "oci-image" && component.Kind != "runtime" && component.Kind != "desktop" && component.Kind != "support-file" {
		return errors.New("kind ไม่ถูกต้อง")
	}
	parsedURL, err := url.Parse(component.URL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.User != nil || parsedURL.Fragment != "" {
		return errors.New("url ต้องเป็น HTTPS โดยไม่มี credential/fragment")
	}
	if !hexPattern.MatchString(component.SHA256) || component.SizeBytes <= 0 {
		return errors.New("SHA-256/size ไม่ถูกต้อง")
	}
	if component.Kind == "oci-image" {
		if !digestPattern.MatchString(component.OCIDigest) {
			return errors.New("ขาด immutable OCI digest")
		}
		if !imageRefPattern.MatchString(component.ImageRef) {
			return errors.New("ขาด imageRef")
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
