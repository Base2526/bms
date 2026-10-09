package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestLicenseUIRuntimeMaintenanceLock(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires the Linux guest's flock implementation")
	}
	if _, err := exec.LookPath("flock"); err != nil {
		t.Fatal("runtime dependency flock missing")
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	unlock, err := lockLicenseUIRuntime(ctx, root, "linux-native", "")
	if err != nil {
		t.Fatal(err)
	}
	if second, err := lockLicenseUIRuntime(ctx, root, "linux-native", ""); err == nil {
		second()
		unlock()
		t.Fatal("concurrent registration acquired the runtime lock")
	}
	unlock()
	if err = os.WriteFile(filepath.Join(root, "update-active"), []byte("1.2.3"), 0600); err != nil {
		t.Fatal(err)
	}
	if second, err := lockLicenseUIRuntime(ctx, root, "linux-native", ""); err == nil {
		second()
		t.Fatal("registration started between update begin and commit")
	}
	_ = os.Remove(filepath.Join(root, "update-active"))
	unlock, err = lockLicenseUIRuntime(ctx, root, "linux-native", "")
	if err != nil {
		t.Fatal("lock was not released after maintenance check", err)
	}
	unlock()
}

func TestLicenseUIAtomicWriteIgnoresPredictableTemporary(t *testing.T) {
	destination := filepath.Join(t.TempDir(), "activation.json")
	if err := os.WriteFile(destination+".tmp", []byte("do-not-touch"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeLicenseUIPrivateFile(destination, []byte(`{"safe":true}`)); err != nil {
		t.Fatal(err)
	}
	untouched, err := os.ReadFile(destination + ".tmp")
	if err != nil || string(untouched) != "do-not-touch" {
		t.Fatal("write followed a predictable temporary file")
	}
	stored, err := readUIFile(destination)
	if err != nil || string(stored) != `{"safe":true}` {
		t.Fatal("atomic destination missing")
	}
}

func TestLicenseUILinuxFilesystemMailbox(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires the native Linux mailbox implementation")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "license-ui", "requests"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "installation.json"), []byte(`{"tenantId":"tenant-test","posDeviceId":"pos-test","version":"1.2.3","platformTarget":"ubuntu-24.04-lts-x64","packageType":"server"}`), 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/activate" {
			calls++
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	bridge := newLicenseUIBridge(root, "linux-native", "", server.URL+"/activate")
	bridge.client = server.Client()
	readView := func() licenseUISnapshot {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(root, "license-ui", "status", "view.json"))
		if err != nil {
			t.Fatal(err)
		}
		var view licenseUISnapshot
		if err := json.Unmarshal(data, &view); err != nil {
			t.Fatal(err)
		}
		return view
	}
	if err := bridge.poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	view := readView()
	if !view.Available || view.Registered || view.TenantID != "tenant-test" || time.Since(view.Heartbeat) > time.Minute {
		t.Fatal("unregistered Linux host did not publish a usable heartbeat")
	}
	request := licenseUIRequest{RequestID: "01234567-1234-4234-8234-123456789abc", TenantID: "tenant-test", ActivationCode: "bmsla_" + strings.Repeat("x", 43), CreatedAt: time.Now()}
	requestPath := filepath.Join(root, "license-ui", "requests", "activation.json")
	if err := writeLicenseUIJSON(requestPath, request); err != nil {
		t.Fatal(err)
	}
	if err := bridge.poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	view = readView()
	if calls != 1 || !view.Available || view.RequestID != request.RequestID || view.RequestStatus != "FAILED" || view.ErrorCode != "CODE_REJECTED" {
		t.Fatal("native mailbox did not return the activation result")
	}
	data, err := os.ReadFile(requestPath)
	if err != nil || strings.Contains(string(data), request.ActivationCode) {
		t.Fatal("activation code was not cleared from the shared mailbox")
	}
}

func TestLicenseUIRecoveryAndPrivacy(t *testing.T) {
	for _, scenario := range []string{"success", "lost-response", "receipt-failure", "invalid-tenant", "rejected", "expired-request", "restored-shop", "license-mismatch", "old-server-mismatch"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			calls := 0
			records := 0
			writes := 0
			var requestID string
			token := "bmslt_" + strings.Repeat("x", 43)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/activate" {
					calls++
					var input map[string]string
					_ = json.NewDecoder(r.Body).Decode(&input)
					if requestID != "" && requestID != input["requestId"] {
						t.Error("retry changed request identity")
					}
					requestID = input["requestId"]
					if strings.Contains(scenario, "mismatch") {
						if input["currentLicenseCode"] != "LIC-existing" {
							t.Error("activation did not constrain the existing license")
						}
						if scenario == "license-mismatch" {
							w.WriteHeader(409)
							_ = json.NewEncoder(w).Encode(map[string]string{"error": "license_mismatch"})
							return
						}
					}
					if scenario == "rejected" {
						w.WriteHeader(409)
						return
					}
					if scenario == "lost-response" && calls == 1 {
						_, _ = w.Write([]byte("lost response"))
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"licenseCode": "LIC-new", "ingestionToken": token})
					return
				}
				if r.Header.Get("Authorization") != "Bearer "+token {
					t.Error("status missing authentication")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"licenseCode": "LIC-new", "licenseType": "TRIAL", "commercialStatus": "TRIAL_ACTIVE", "registrationStatus": "ACTIVE", "trialDaysRemaining": 24, "checkedAt": time.Now().UTC()})
			}))
			defer server.Close()
			guest := map[string][]byte{"installation.json": []byte(`{"tenantId":"tenant-original","posDeviceId":"device-original","version":"1.2.3","platformTarget":"windows-11-x64","shopMarker":"keep"}`)}
			if scenario == "restored-shop" {
				guest["installation.json"] = []byte(`{"tenantId":"tenant-original","posDeviceId":"device-original","version":"1.2.3","platformTarget":"windows-11-x64","shopMarker":"keep","licenseCode":"LIC-new"}`)
			}
			if strings.Contains(scenario, "mismatch") {
				guest["installation.json"] = []byte(`{"tenantId":"tenant-original","posDeviceId":"device-original","version":"1.2.3","platformTarget":"windows-11-x64","shopMarker":"keep","licenseCode":"LIC-existing"}`)
			}
			req := licenseUIRequest{RequestID: "01234567-1234-4234-8234-123456789abc", TenantID: "tenant-original", ActivationCode: "bmsla_" + strings.Repeat("a", 43), CreatedAt: time.Now()}
			if scenario == "invalid-tenant" {
				req.TenantID = "other-tenant"
			}
			if scenario == "expired-request" {
				req.CreatedAt = time.Now().Add(-11 * time.Minute)
			}
			guest["license-ui/requests/activation.json"], _ = json.Marshal(req)
			b := newLicenseUIBridge(root, "windows-wsl", "BMSRuntime", server.URL+"/activate")
			b.client = server.Client()
			b.read = func(name string) ([]byte, error) {
				data, ok := guest[name]
				if !ok {
					return nil, os.ErrNotExist
				}
				return data, nil
			}
			b.write = func(name string, data []byte) error {
				if name == "installation.json" {
					writes++
					if scenario == "receipt-failure" && writes == 1 {
						return errors.New("simulated receipt failure")
					}
				}
				guest[name] = data
				return nil
			}
			b.record = func(ctx context.Context, input licenseEvidenceInput) (licenseEvidenceResult, error) {
				records++
				if input.TenantID != "tenant-original" || input.POSDeviceID != "device-original" {
					t.Error("shop identity changed")
				}
				if scenario == "restored-shop" && input.EventType != "TRANSFER_REQUESTED" {
					t.Error("replacement host must request transfer even for the same license")
				}
				dir := filepath.Join(root, "license-evidence")
				_ = os.MkdirAll(dir, 0700)
				_ = writePrivateJSON(filepath.Join(dir, "profile.json"), licenseEvidenceProfile{LicenseID: input.LicenseID, TenantID: input.TenantID, EvidenceEndpoint: input.Endpoint, EvidenceToken: input.EvidenceToken})
				_ = writePrivateJSON(filepath.Join(dir, "state.json"), licenseEvidenceState{InstallationID: "01234567-1234-4234-8234-123456789def"})
				return licenseEvidenceResult{OK: true, Recorded: true}, nil
			}
			err := b.poll(context.Background())
			if scenario == "invalid-tenant" {
				if err == nil || calls != 0 || records != 0 {
					t.Fatal("must reject before redemption")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "lost-response" || scenario == "receipt-failure" {
				if _, err := os.Stat(filepath.Join(root, "license-ui-host", "activation.json")); err != nil {
					t.Fatal("missing retry checkpoint")
				}
			}
			if err = b.poll(context.Background()); err != nil {
				t.Fatal(err)
			}
			status := guest["license-ui/status/view.json"]
			for _, name := range []string{"license-ui/status/view.json", "license-ui/requests/activation.json"} {
				if strings.Contains(string(guest[name]), token) || strings.Contains(string(guest[name]), req.ActivationCode) {
					t.Fatalf("secret in shared file %s", name)
				}
			}
			var view licenseUISnapshot
			_ = json.Unmarshal(status, &view)
			if strings.Contains(scenario, "mismatch") {
				if view.RequestStatus != "FAILED" || view.ErrorCode != "LICENSE_MISMATCH" || records != 0 || calls != 1 || writes != 0 {
					t.Fatal("wrong-license activation must preserve the old registration")
				}
				return
			}
			if scenario == "expired-request" {
				if view.RequestStatus != "FAILED" || view.ErrorCode != "REQUEST_EXPIRED" || calls != 0 || records != 0 {
					t.Fatal("expired request must terminate without consuming the code")
				}
				return
			}
			if scenario == "rejected" {
				if view.RequestStatus != "FAILED" || records != 0 || calls != 1 {
					t.Fatal("rejected code must terminate without changing shop")
				}
				return
			}
			if view.RequestStatus != "SUCCEEDED" || view.CommercialStatus != "TRIAL_ACTIVE" || records != 1 {
				t.Fatalf("unexpected result: %s, records %d", status, records)
			}
			if !strings.Contains(string(guest["installation.json"]), `"shopMarker":"keep"`) {
				t.Fatal("receipt data lost")
			}
			host, err := os.ReadFile(filepath.Join(root, "installation.json"))
			if err != nil || string(host) != string(guest["installation.json"]) {
				t.Fatal("host/guest mismatch")
			}
			if err = b.poll(context.Background()); err != nil {
				t.Fatal(err)
			}
			if records != 1 {
				t.Fatal("replayed completed registration")
			}
			// Cloud failure preserves the last verified state instead of claiming expiry.
			view.CheckedAt = func() *time.Time { x := time.Now().Add(-time.Hour); return &x }()
			_ = writePrivateJSON(filepath.Join(root, "license-ui-host", "view.json"), view)
			server.Close()
			if err = b.poll(context.Background()); err != nil {
				t.Fatal(err)
			}
			_ = json.Unmarshal(guest["license-ui/status/view.json"], &view)
			if view.Online || view.CommercialStatus != "TRIAL_ACTIVE" {
				t.Fatal("offline status fabricated commercial state")
			}
		})
	}
}
