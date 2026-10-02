package main

// The host is the only holder of the evidence token and signing key. Web shares
// one bounded request mailbox and a read-only, secret-free status directory.
import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const uiRuntimeRoot = "/var/lib/bms-retail-local"

var activationCodePattern = regexp.MustCompile(`^bmsla_[A-Za-z0-9_-]{43}$`)
var uiRequestPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type licenseUIRequest struct {
	RequestID      string    `json:"requestId"`
	TenantID       string    `json:"tenantId"`
	ActivationCode string    `json:"activationCode"`
	CreatedAt      time.Time `json:"createdAt"`
}
type licenseUICheckpoint struct {
	Request     licenseUIRequest `json:"request"`
	LicenseCode string           `json:"licenseCode"`
	Token       string           `json:"token"`
	Recorded    bool             `json:"recorded"`
}
type licenseUISnapshot struct {
	TenantID           string     `json:"tenantId"`
	Heartbeat          time.Time  `json:"heartbeat"`
	Available          bool       `json:"available"`
	Registered         bool       `json:"registered"`
	Online             bool       `json:"online"`
	LicenseCode        string     `json:"licenseCode,omitempty"`
	LicenseType        string     `json:"licenseType,omitempty"`
	CommercialStatus   string     `json:"commercialStatus,omitempty"`
	TrialExpiresAt     *time.Time `json:"trialExpiresAt,omitempty"`
	TrialDaysRemaining *int       `json:"trialDaysRemaining,omitempty"`
	RegistrationStatus string     `json:"registrationStatus,omitempty"`
	ReviewRequired     bool       `json:"reviewRequired"`
	CheckedAt          *time.Time `json:"checkedAt,omitempty"`
	RequestID          string     `json:"requestId,omitempty"`
	RequestStatus      string     `json:"requestStatus,omitempty"`
	ErrorCode          string     `json:"errorCode,omitempty"`
}
type licenseUIBridge struct {
	root, engine, distro, activationURI string
	client                              *http.Client
	ctx                                 context.Context
	// File operations are injected in tests to exercise host/guest crash recovery.
	read   func(string) ([]byte, error)
	write  func(string, []byte) error
	record func(context.Context, licenseEvidenceInput) (licenseEvidenceResult, error)
}

func newLicenseUIBridge(root, engine, distro, activationURI string) *licenseUIBridge {
	b := &licenseUIBridge{root: root, engine: engine, distro: distro, activationURI: activationURI, ctx: context.Background(),
		client: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, record: recordLicenseEvidence}
	b.read = func(name string) ([]byte, error) {
		if engine == "linux-native" {
			return readUIFile(filepath.Join(root, filepath.FromSlash(name)))
		}
		cmd, err := licenseUICommand(b.ctx, engine, distro, "set -eu; test -f "+quoteShellArgument(uiRuntimeRoot+"/"+name)+"; test ! -L "+quoteShellArgument(uiRuntimeRoot+"/"+name)+"; head -c 65537 "+quoteShellArgument(uiRuntimeRoot+"/"+name))
		if err != nil {
			return nil, err
		}
		return cmd.Output()
	}
	b.write = func(name string, data []byte) error {
		if engine == "linux-native" {
			target := filepath.Join(root, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				return err
			}
			return writeLicenseUIPrivateFile(target, data)
		}
		// The request directory is writable by Web. Never follow a predictable
		// .tmp symlink supplied there, even though all destination names are fixed.
		cmd, err := licenseUICommand(b.ctx, engine, distro, licenseUIWriteScript(uiRuntimeRoot+"/"+name, data))
		if err != nil {
			return err
		}
		cmd.Stdin = bytes.NewReader(data)
		if err = cmd.Run(); err != nil {
			return errors.New("license mailbox write failed")
		}
		return nil
	}
	return b
}

func licenseUIWriteScript(destination string, data []byte) string {
	return fmt.Sprintf(`set -eu; umask 077; target=%s; directory=%s; mkdir -p "$directory"; temporary=$(mktemp "$directory/.license-ui.XXXXXX"); trap 'rm -f -- "$temporary"' EXIT; cat > "$temporary"; test "$(wc -c < "$temporary")" -eq %d; test "$(sha256sum "$temporary" | cut -d ' ' -f 1)" = '%x'; chmod 0600 "$temporary"; sync -f "$temporary"; mv -fT -- "$temporary" "$target"; sync -f "$directory"`,
		quoteShellArgument(destination), quoteShellArgument(path.Dir(destination)), len(data), sha256.Sum256(data))
}

func writeLicenseUIPrivateFile(destination string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(destination), ".license-ui-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	defer file.Close()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(temporary, destination); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(destination))
}

func writeLicenseUIJSON(destination string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeLicenseUIPrivateFile(destination, data)
}
func readUIFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64*1024 {
		return nil, errors.New("invalid license file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 64*1024+1))
	if len(data) > 64*1024 {
		return nil, errors.New("invalid license file")
	}
	return data, err
}
func (b *licenseUIBridge) call(ctx context.Context, endpoint, token string, body, result any) (int, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := b.client.Do(req)
	if err != nil {
		return 0, errors.New("connection unavailable")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(data) > 64*1024 {
		return response.StatusCode, errors.New("invalid response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = json.Unmarshal(data, result) // Only typed, allow-listed error codes are displayed.
		return response.StatusCode, errors.New("request rejected")
	}
	return response.StatusCode, json.Unmarshal(data, result)
}
func (b *licenseUIBridge) poll(ctx context.Context) error {
	if err := validateEvidenceEndpoint(b.activationURI); err != nil {
		return err
	}
	origin, err := url.Parse(b.activationURI)
	if err != nil {
		return err
	}
	origin.Path = ""
	origin.RawQuery = ""
	origin.Fragment = ""
	hostRoot := filepath.Join(b.root, "license-ui-host")
	if err = os.MkdirAll(hostRoot, 0700); err != nil {
		return err
	}
	unlock, err := acquireInstallLock(hostRoot)
	if err != nil {
		return err
	}
	defer unlock()
	raw, err := b.read("installation.json")
	if err != nil {
		return errors.New("installation receipt unavailable")
	}
	var receipt map[string]any
	if len(raw) > 64*1024 || json.Unmarshal(raw, &receipt) != nil {
		return errors.New("invalid receipt")
	}
	field := func(name string) string { value, _ := receipt[name].(string); return value }
	for _, key := range []string{"tenantId", "posDeviceId", "platformTarget", "version"} {
		if !licenseFieldPattern.MatchString(field(key)) {
			return errors.New("incomplete receipt")
		}
	}
	packageType := field("packageType")
	if packageType == "" {
		packageType = "server-pos"
	}
	if packageType != "server" && packageType != "server-pos" {
		return errors.New("invalid installation package type")
	}
	// Anonymous fleet inventory is independent from licensing and is always
	// best-effort. It uses a random installation credential, never hardware IDs.
	_ = reportInstallationTelemetry(ctx, installationTelemetryInput{Root: b.root, ControlURI: b.activationURI,
		Event: "SEEN", PackageType: packageType, PlatformTarget: field("platformTarget"), ReleaseVersion: field("version"),
		TenantReference: field("tenantId"), LicenseReference: field("licenseCode")})
	// Guest receipt is authoritative after update/restore. Repair a stale host
	// copy on every poll, not only on a new activation.
	if b.engine != "linux-native" {
		if err = writeLicenseUIPrivateFile(filepath.Join(b.root, "installation.json"), raw); err != nil {
			return err
		}
	}
	statePath := filepath.Join(hostRoot, "view.json")
	var view licenseUISnapshot
	if data, err := readUIFile(statePath); err == nil {
		_ = json.Unmarshal(data, &view)
	}
	if view.TenantID != "" && view.TenantID != field("tenantId") {
		return errors.New("installation identity changed")
	}
	view.TenantID = field("tenantId")
	view.Heartbeat = time.Now().UTC()
	view.Available = true
	checkpointPath := filepath.Join(hostRoot, "activation.json")
	var checkpoint licenseUICheckpoint
	if data, err := readUIFile(checkpointPath); err == nil {
		if json.Unmarshal(data, &checkpoint) != nil {
			return errors.New("invalid activation checkpoint")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if checkpoint.Request.RequestID == "" {
		if data, err := b.read("license-ui/requests/activation.json"); err == nil && len(data) <= 4096 {
			var request licenseUIRequest
			if json.Unmarshal(data, &request) == nil && request.RequestID != view.RequestID && request.RequestID != "" {
				if !uiRequestPattern.MatchString(request.RequestID) || request.TenantID != field("tenantId") {
					return errors.New("invalid activation request")
				}
				if !activationCodePattern.MatchString(request.ActivationCode) || time.Since(request.CreatedAt) > 10*time.Minute || time.Until(request.CreatedAt) > time.Minute {
					view.RequestID, view.RequestStatus, view.ErrorCode = request.RequestID, "FAILED", "REQUEST_EXPIRED"
					request.ActivationCode = ""
					encoded, _ := json.Marshal(request)
					if err = b.write("license-ui/requests/activation.json", encoded); err != nil {
						return err
					}
					return b.publish(view, statePath)
				}
				checkpoint.Request = request
				if err = writeLicenseUIJSON(checkpointPath, checkpoint); err != nil {
					return err
				}
			}
		}
	}
	if checkpoint.Request.RequestID != "" {
		if checkpoint.Request.TenantID != field("tenantId") {
			return errors.New("checkpoint tenant mismatch")
		}
		view.RequestID = checkpoint.Request.RequestID
		view.RequestStatus = "PENDING"
		view.ErrorCode = ""
		// Remove the code from the web mailbox after the private retry checkpoint is durable.
		safeRequest := checkpoint.Request
		safeRequest.ActivationCode = ""
		encoded, _ := json.Marshal(safeRequest)
		if err = b.write("license-ui/requests/activation.json", encoded); err != nil {
			return err
		}
		if checkpoint.Token == "" {
			var exchange struct {
				LicenseCode string `json:"licenseCode"`
				Token       string `json:"ingestionToken"`
				Error       string `json:"error"`
			}
			body := map[string]string{"activationCode": checkpoint.Request.ActivationCode, "requestId": checkpoint.Request.RequestID}
			if current := field("licenseCode"); current != "" {
				body["currentLicenseCode"] = current
			}
			status, exchangeErr := b.call(ctx, b.activationURI, "", body, &exchange)
			if exchangeErr != nil {
				view.ErrorCode = "CONNECTION_UNAVAILABLE"
				if status == 400 || status == 401 || status == 409 {
					view.RequestStatus = "FAILED"
					view.ErrorCode = "CODE_REJECTED"
					if exchange.Error == "license_mismatch" {
						view.ErrorCode = "LICENSE_MISMATCH"
					}
					if err = b.publish(view, statePath); err != nil {
						return err
					}
					return os.Remove(checkpointPath)
				}
				return b.publish(view, statePath)
			}
			if !licenseFieldPattern.MatchString(exchange.LicenseCode) || !licenseEvidenceTokenPattern.MatchString(exchange.Token) {
				view.ErrorCode = "INVALID_RESPONSE"
				return b.publish(view, statePath)
			}
			checkpoint.LicenseCode = exchange.LicenseCode
			checkpoint.Token = exchange.Token
			checkpoint.Request.ActivationCode = ""
			if err = writeLicenseUIJSON(checkpointPath, checkpoint); err != nil {
				return err
			}
		}
		// Also guard already-redeemed checkpoints from older hosts/control planes.
		if current := field("licenseCode"); current != "" && current != checkpoint.LicenseCode {
			view.RequestStatus, view.ErrorCode = "FAILED", "LICENSE_MISMATCH"
			if err = b.publish(view, statePath); err != nil {
				return err
			}
			return os.Remove(checkpointPath)
		}
		if !checkpoint.Recorded {
			event := "INSTALLATION_REGISTERED"
			// Restoring a shop copies its reference, never its host signing identity.
			// Even the same license needs transfer review on a replacement computer.
			var previousState licenseEvidenceState
			previousData, previousErr := readUIFile(filepath.Join(b.root, "license-evidence", "state.json"))
			hasIdentity := previousErr == nil && json.Unmarshal(previousData, &previousState) == nil && previousState.InstallationID != ""
			if field("licenseCode") != "" && (field("licenseCode") != checkpoint.LicenseCode || !hasIdentity) {
				event = "TRANSFER_REQUESTED"
			}
			_, err = b.record(ctx, licenseEvidenceInput{Root: b.root, EventType: event, LicenseID: checkpoint.LicenseCode, TenantID: field("tenantId"), POSDeviceID: field("posDeviceId"), PlatformTarget: field("platformTarget"), ReleaseVersion: field("version"), Endpoint: origin.String() + "/api/bms/retail-local/license-evidence", EvidenceToken: checkpoint.Token})
			if err != nil {
				view.ErrorCode = "RECORD_RETRY"
				return b.publish(view, statePath)
			}
			checkpoint.Recorded = true
			if err = writeLicenseUIJSON(checkpointPath, checkpoint); err != nil {
				return err
			}
		}
		receipt["licenseCode"] = checkpoint.LicenseCode
		updated, _ := json.Marshal(receipt)
		if err = b.write("installation.json", updated); err != nil {
			view.ErrorCode = "RECEIPT_RETRY"
			return b.publish(view, statePath)
		}
		if err = writeLicenseUIPrivateFile(filepath.Join(b.root, "installation.json"), updated); err != nil {
			return err
		}
		view.RequestStatus = "SUCCEEDED"
		view.ErrorCode = ""
		// Persist terminal request identity before retiring the retry checkpoint.
		if err = writeLicenseUIJSON(statePath, view); err != nil {
			return err
		}
		if err = os.Remove(checkpointPath); err != nil {
			return err
		}
	}
	changedLicense := view.LicenseCode != field("licenseCode")
	if changedLicense {
		view.LicenseType = ""
		view.CommercialStatus = ""
		view.CheckedAt = nil
		view.TrialExpiresAt = nil
		view.TrialDaysRemaining = nil
		view.RegistrationStatus = ""
		view.ReviewRequired = false
	}
	view.LicenseCode = field("licenseCode")
	view.Registered = view.LicenseCode != ""
	if !view.Registered {
		view.Online = false
		return b.publish(view, statePath)
	}
	var profile licenseEvidenceProfile
	var evidenceState licenseEvidenceState
	profileData, pErr := readUIFile(filepath.Join(b.root, "license-evidence", "profile.json"))
	evidenceData, sErr := readUIFile(filepath.Join(b.root, "license-evidence", "state.json"))
	if pErr != nil || sErr != nil || json.Unmarshal(profileData, &profile) != nil || json.Unmarshal(evidenceData, &evidenceState) != nil || profile.TenantID != view.TenantID || profile.LicenseID != view.LicenseCode {
		view.Online = false
		return b.publish(view, statePath)
	}
	// Existing command-line registrations are picked up here too. Evidence retries
	// keep their original event identity; this does not create a second installation.
	_, _ = flushLicenseEvidence(ctx, b.root, profile.EvidenceEndpoint, profile.EvidenceToken)
	if view.CheckedAt == nil || time.Since(*view.CheckedAt) > 5*time.Minute {
		var remote licenseUISnapshot
		_, err = b.call(ctx, origin.String()+"/api/bms/retail-local/license-status", profile.EvidenceToken, map[string]string{"installationId": evidenceState.InstallationID}, &remote)
		view.Online = err == nil && remote.LicenseCode == profile.LicenseID && remote.CheckedAt != nil
		if view.Online {
			view.LicenseType = remote.LicenseType
			view.CommercialStatus = remote.CommercialStatus
			view.TrialExpiresAt = remote.TrialExpiresAt
			view.TrialDaysRemaining = remote.TrialDaysRemaining
			view.RegistrationStatus = remote.RegistrationStatus
			view.ReviewRequired = remote.ReviewRequired
			view.CheckedAt = remote.CheckedAt
		}
	}
	return b.publish(view, statePath)
}
func (b *licenseUIBridge) publish(view licenseUISnapshot, path string) error {
	if err := writeLicenseUIJSON(path, view); err != nil {
		return err
	}
	data, err := json.Marshal(view)
	if err != nil {
		return err
	}
	return b.write("license-ui/status/view.json", data)
}

func runLicenseUI(ctx context.Context, root, engine, distro, activationURI string) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if engine != "linux-native" && engine != "windows-wsl" && engine != "macos-lima" {
		return fmt.Errorf("unsupported license bridge engine")
	}
	if engine == "windows-wsl" {
		// Polling licensing must not start a shop that the operator deliberately stopped.
		output, err := exec.CommandContext(ctx, "wsl.exe", "--list", "--running", "--quiet").Output()
		if err != nil {
			return errors.New("runtime unavailable")
		}
		running := false
		for _, name := range strings.Fields(strings.ReplaceAll(string(output), "\x00", "")) {
			if name == distro {
				running = true
			}
		}
		if !running {
			return nil
		}
	}
	unlock, err := lockLicenseUIRuntime(ctx, root, engine, distro)
	if err != nil {
		return err
	}
	defer unlock()
	bridge := newLicenseUIBridge(root, engine, distro, activationURI)
	bridge.ctx = ctx
	return bridge.poll(ctx)
}

func licenseUICommand(ctx context.Context, engine, distro, script string) (*exec.Cmd, error) {
	command, err := runtimeShellCommand(engine, distro, script)
	if err != nil {
		return nil, err
	}
	command = exec.CommandContext(ctx, command.Path, command.Args[1:]...)
	command.WaitDelay = time.Second
	return command, nil
}

// Hold the guest's advisory lock until stdin closes. Update/restore use the same
// lock, and update-active excludes polling between the begin and commit commands.
func licenseUILockScript(root string) string {
	return "set -eu; umask 077; exec 9>" + quoteShellArgument(path.Join(root, ".license-ui.lock")) +
		"; flock -n 9; test ! -e " + quoteShellArgument(path.Join(root, "update-active")) +
		"; printf 'ready\\n'; read -r release || true"
}

func lockLicenseUIRuntime(ctx context.Context, root, engine, distro string) (func(), error) {
	guestRoot := uiRuntimeRoot
	if engine == "linux-native" {
		guestRoot = root
	}
	command, err := licenseUICommand(ctx, engine, distro, licenseUILockScript(guestRoot))
	if err != nil {
		return nil, err
	}
	input, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		_ = input.Close()
		return nil, err
	}
	if err = command.Start(); err != nil {
		_ = input.Close()
		return nil, err
	}
	ready, err := bufio.NewReader(output).ReadString('\n')
	if err != nil || ready != "ready\n" {
		_ = input.Close()
		_ = command.Wait()
		return nil, errors.New("runtime maintenance in progress or license lock unavailable")
	}
	return func() { _ = input.Close(); _ = command.Wait() }, nil
}
