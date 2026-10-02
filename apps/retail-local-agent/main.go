package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const agentVersion = "0.5.6"

var errPreflightFailed = errors.New("preflight failed")

func main() {
	if err := run(os.Args[1:]); err != nil {
		if errors.Is(err, errPreflightFailed) {
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	restoreConsole := preventConsoleSelectionPause()
	defer restoreConsole()
	if len(args) == 0 {
		return errors.New("usage: bms-runtime-agent <preflight|verify-release|check-update|verify-update|stage-release|stage-server|stage-desktop|engine-load|runtime-write|runtime-install-control|runtime-read|installation-report|license-record|license-pulse|license-flush|license-ui|version>")
	}
	switch args[0] {
	case "installation-report":
		flags := flag.NewFlagSet("installation-report", flag.ContinueOnError)
		root := flags.String("root", "", "private installation state root")
		controlURI := flags.String("control-uri", "", "trusted BMS HTTPS origin")
		event := flags.String("event", "SEEN", "INSTALLED, SEEN, UPDATED, or UNINSTALLED")
		packageType := flags.String("package-type", "", "pos, server, or server-pos")
		target := flags.String("target", "", "platform target")
		releaseVersion := flags.String("release-version", "", "installed release version")
		tenant := flags.String("tenant-reference", "", "optional local tenant reference")
		license := flags.String("license-reference", "", "optional commercial license reference")
		force := flags.Bool("force", false, "report even inside the heartbeat interval")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *root == "" || *controlURI == "" || *packageType == "" || *target == "" || *releaseVersion == "" {
			return errors.New("installation-report requires -root, -control-uri, -package-type, -target and -release-version")
		}
		absolute, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		return reportInstallationTelemetry(ctx, installationTelemetryInput{Root: absolute, ControlURI: *controlURI,
			Event: *event, PackageType: *packageType, PlatformTarget: *target, ReleaseVersion: *releaseVersion,
			TenantReference: *tenant, LicenseReference: *license, Force: *force})
	case "license-ui":
		flags := flag.NewFlagSet("license-ui", flag.ContinueOnError)
		root := flags.String("root", "", "Managed Runtime data root")
		engine := flags.String("engine", "", "host engine")
		distro := flags.String("distro", "", "private VM name")
		activation := flags.String("activation-uri", "", "trusted activation endpoint")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *root == "" {
			return errors.New("license-ui requires -root")
		}
		absolute, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return runLicenseUI(ctx, absolute, *engine, *distro, *activation)
	case "version":
		fmt.Println(agentVersion)
		return nil
	case "preflight":
		result := platformPreflight()
		if len(args) == 2 && args[1] == "--human" {
			result.writeHuman()
		} else {
			if len(args) != 1 {
				return errors.New("usage: bms-runtime-agent preflight [--human]")
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				return err
			}
			fmt.Println(string(encoded))
		}
		if !result.OK {
			return errPreflightFailed
		}
		return nil
	case "verify-release":
		flags := flag.NewFlagSet("verify-release", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" {
			return errors.New("verify-release ต้องมี -manifest, -keyring และ -target")
		}
		verified, err := verifyReleaseFiles(*manifest, *keyring, *target)
		if err != nil {
			return err
		}
		return writeJSON(map[string]any{
			"ok":             true,
			"keyId":          verified.Header.KeyID,
			"releaseVersion": verified.Payload.ReleaseVersion,
			"channel":        verified.Payload.Channel,
			"platformTarget": verified.Payload.PlatformTarget,
			"rollbackSafe":   verified.Payload.RollbackSafe,
			"schemaVersion":  verified.Payload.SchemaVersion,
			"createdAt":      verified.Payload.CreatedAt,
			"sourceCommit":   verified.Payload.SourceCommit,
			"components":     verified.Payload.Components,
		})
	case "check-update":
		flags := flag.NewFlagSet("check-update", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		currentVersion := flags.String("current-version", "", "currently installed semantic version")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" || *currentVersion == "" {
			return errors.New("check-update ต้องมี -manifest, -keyring, -target และ -current-version")
		}
		verified, err := verifyReleaseFiles(*manifest, *keyring, *target)
		if err != nil {
			return err
		}
		comparison, err := compareSemver(verified.Payload.ReleaseVersion, *currentVersion)
		if err != nil {
			return err
		}
		if comparison < 0 {
			return fmt.Errorf("ปฏิเสธ release downgrade: ติดตั้ง %s แต่ได้รับ %s", *currentVersion, verified.Payload.ReleaseVersion)
		}
		return writeJSON(map[string]any{
			"ok": true, "updateAvailable": comparison > 0, "releaseVersion": verified.Payload.ReleaseVersion,
			"channel":        verified.Payload.Channel,
			"platformTarget": verified.Payload.PlatformTarget, "rollbackSafe": verified.Payload.RollbackSafe,
			"schemaVersion": verified.Payload.SchemaVersion, "createdAt": verified.Payload.CreatedAt,
			"sourceCommit": verified.Payload.SourceCommit, "components": verified.Payload.Components,
		})
	case "verify-update":
		flags := flag.NewFlagSet("verify-update", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		currentVersion := flags.String("current-version", "", "currently installed semantic version")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" || *currentVersion == "" {
			return errors.New("verify-update ต้องมี -manifest, -keyring, -target และ -current-version")
		}
		verified, err := verifyReleaseFiles(*manifest, *keyring, *target)
		if err != nil {
			return err
		}
		comparison, err := compareSemver(verified.Payload.ReleaseVersion, *currentVersion)
		if err != nil {
			return err
		}
		if comparison <= 0 {
			return fmt.Errorf("ปฏิเสธ release replay/downgrade: ติดตั้ง %s แต่ได้รับ %s", *currentVersion, verified.Payload.ReleaseVersion)
		}
		return writeJSON(map[string]any{
			"ok": true, "releaseVersion": verified.Payload.ReleaseVersion,
			"channel":        verified.Payload.Channel,
			"platformTarget": verified.Payload.PlatformTarget, "rollbackSafe": verified.Payload.RollbackSafe,
			"schemaVersion": verified.Payload.SchemaVersion, "createdAt": verified.Payload.CreatedAt,
			"sourceCommit": verified.Payload.SourceCommit, "components": verified.Payload.Components,
		})
	case "stage-release":
		flags := flag.NewFlagSet("stage-release", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		root := flags.String("root", "", "Managed Runtime data root")
		testCA := flags.String("test-ca", "", "explicit loopback-only test release CA")
		progress := flags.Bool("progress", false, "emit machine-readable progress events")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" || *root == "" {
			return errors.New("stage-release ต้องมี -manifest, -keyring, -target และ -root")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		var reporter progressReporter
		if *progress {
			reporter = writeProgressEvent
		}
		result, err := stageReleaseWithTestCA(ctx, *manifest, *keyring, *target, absoluteRoot, *testCA, reporter)
		if err != nil {
			return err
		}
		return writeJSON(result)
	case "stage-server":
		flags := flag.NewFlagSet("stage-server", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		root := flags.String("root", "", "Managed Runtime data root")
		testCA := flags.String("test-ca", "", "explicit loopback-only test release CA")
		progress := flags.Bool("progress", false, "emit machine-readable progress events")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" || *root == "" {
			return errors.New("stage-server ต้องมี -manifest, -keyring, -target และ -root")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		var reporter progressReporter
		if *progress {
			reporter = writeProgressEvent
		}
		result, err := stageServerWithTestCA(ctx, *manifest, *keyring, *target, absoluteRoot, *testCA, reporter)
		if err != nil {
			return err
		}
		return writeJSON(result)
	case "stage-desktop":
		flags := flag.NewFlagSet("stage-desktop", flag.ContinueOnError)
		manifest := flags.String("manifest", "", "signed release envelope")
		keyring := flags.String("keyring", "", "trusted Ed25519 public-key ring")
		target := flags.String("target", "", "expected platform target")
		root := flags.String("root", "", "POS bootstrap data root")
		testCA := flags.String("test-ca", "", "explicit loopback-only test release CA")
		progress := flags.Bool("progress", false, "emit machine-readable progress events")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *manifest == "" || *keyring == "" || *target == "" || *root == "" {
			return errors.New("stage-desktop ต้องมี -manifest, -keyring, -target และ -root")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		var reporter progressReporter
		if *progress {
			reporter = writeProgressEvent
		}
		result, err := stageDesktopWithTestCA(ctx, *manifest, *keyring, *target, absoluteRoot, *testCA, reporter)
		if err != nil {
			return err
		}
		return writeJSON(result)
	case "engine-load":
		flags := flag.NewFlagSet("engine-load", flag.ContinueOnError)
		engine := flags.String("engine", "", "windows-wsl, linux-native, or macos-lima")
		distro := flags.String("distro", "BMSRuntime", "private WSL distribution")
		artifact := flags.String("artifact", "", "verified OCI archive")
		imageRef := flags.String("image-ref", "", "image reference contained in archive")
		digest := flags.String("digest", "", "expected immutable image id")
		progress := flags.Bool("progress", false, "emit machine-readable progress events")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *engine == "" || *artifact == "" || *imageRef == "" || *digest == "" {
			return errors.New("engine-load ต้องมี -engine, -artifact, -image-ref และ -digest")
		}
		var reporter progressReporter
		if *progress {
			reporter = writeProgressEvent
		}
		return loadAndVerifyImage(*engine, *distro, *artifact, *imageRef, *digest, reporter)
	case "runtime-write":
		flags := flag.NewFlagSet("runtime-write", flag.ContinueOnError)
		engine := flags.String("engine", "", "windows-wsl, linux-native, or macos-lima")
		distro := flags.String("distro", "BMSRuntime", "private WSL distribution")
		source := flags.String("source", "", "verified source file")
		destination := flags.String("destination", "", "runtime destination below /var/lib/bms-retail-local")
		mode := flags.String("mode", "0600", "destination permissions")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *engine == "" || *source == "" || *destination == "" {
			return errors.New("runtime-write ต้องมี -engine, -source และ -destination")
		}
		return writeRuntimeFile(*engine, *distro, *source, *destination, *mode)
	case "runtime-read":
		flags := flag.NewFlagSet("runtime-read", flag.ContinueOnError)
		engine := flags.String("engine", "", "windows-wsl or macos-lima")
		distro := flags.String("distro", "BMSRuntime", "private WSL distribution")
		source := flags.String("source", "", "runtime source below /var/lib/bms-retail-local")
		destination := flags.String("destination", "", "new host destination file")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *engine == "" || *source == "" || *destination == "" {
			return errors.New("runtime-read ต้องมี -engine, -source และ -destination")
		}
		return readRuntimeFile(*engine, *distro, *source, *destination)
	case "runtime-install-control":
		flags := flag.NewFlagSet("runtime-install-control", flag.ContinueOnError)
		engine := flags.String("engine", "", "windows-wsl or macos-lima")
		distro := flags.String("distro", "BMSRuntime", "private WSL distribution")
		source := flags.String("source", "", "trusted bootstrap control file")
		name := flags.String("name", "", "allow-listed runtime control name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *engine == "" || *source == "" || *name == "" {
			return errors.New("runtime-install-control ต้องมี -engine, -source และ -name")
		}
		return installRuntimeControl(*engine, *distro, *source, *name)
	case "license-record":
		flags := flag.NewFlagSet("license-record", flag.ContinueOnError)
		root := flags.String("root", "", "Managed Runtime data root")
		eventType := flags.String("event", "", "license evidence event type")
		licenseID := flags.String("license-id", "", "commercial license identifier")
		tenantID := flags.String("tenant-id", "", "provisioned tenant identifier")
		posDeviceID := flags.String("pos-device-id", "", "provisioned POS device identifier")
		target := flags.String("target", "", "platform target")
		releaseVersion := flags.String("release-version", "", "installed release version")
		endpoint := flags.String("endpoint", "", "optional HTTPS back-office evidence endpoint")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *root == "" || *eventType == "" || *licenseID == "" || *target == "" || *releaseVersion == "" {
			return errors.New("license-record ต้องมี -root, -event, -license-id, -target และ -release-version")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		result, err := recordLicenseEvidence(context.Background(), licenseEvidenceInput{
			Root: absoluteRoot, EventType: *eventType, LicenseID: *licenseID, TenantID: *tenantID,
			POSDeviceID: *posDeviceID, PlatformTarget: *target, ReleaseVersion: *releaseVersion,
			Endpoint: *endpoint, EvidenceToken: os.Getenv("BMS_LICENSE_EVIDENCE_TOKEN"),
		})
		if err != nil {
			return err
		}
		return writeJSON(result)
	case "license-flush":
		flags := flag.NewFlagSet("license-flush", flag.ContinueOnError)
		root := flags.String("root", "", "Managed Runtime data root")
		endpoint := flags.String("endpoint", "", "HTTPS back-office evidence endpoint")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *root == "" || *endpoint == "" {
			return errors.New("license-flush ต้องมี -root และ -endpoint")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		result, err := flushLicenseEvidence(context.Background(), absoluteRoot, *endpoint,
			os.Getenv("BMS_LICENSE_EVIDENCE_TOKEN"))
		if err != nil {
			return err
		}
		return writeJSON(result)
	case "license-pulse":
		flags := flag.NewFlagSet("license-pulse", flag.ContinueOnError)
		root := flags.String("root", "", "Managed Runtime data root")
		eventType := flags.String("event", "RUNTIME_SEEN", "profile-backed license evidence event type")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *root == "" {
			return errors.New("license-pulse ต้องมี -root")
		}
		absoluteRoot, err := safeInstallRoot(*root)
		if err != nil {
			return err
		}
		result, err := pulseLicenseEvidence(context.Background(), absoluteRoot, *eventType)
		if err != nil {
			return err
		}
		return writeJSON(result)
	default:
		return fmt.Errorf("ไม่รู้จักคำสั่ง %q", args[0])
	}
}

func writeJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func safeInstallRoot(input string) (string, error) {
	root, err := filepath.Abs(input)
	if err != nil {
		return "", fmt.Errorf("อ่าน install root ไม่ได้: %w", err)
	}
	clean := filepath.Clean(root)
	volume := filepath.VolumeName(clean)
	if clean == string(filepath.Separator) || (volume != "" && clean == volume+string(filepath.Separator)) {
		return "", errors.New("ปฏิเสธ install root ที่เป็น filesystem root")
	}
	return clean, nil
}
