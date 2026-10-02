package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallationTelemetryKeepsRandomIdentityAndBoundsHeartbeat(t *testing.T) {
	requests := 0
	var last installationTelemetryPayload
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/api/bms/retail-local/installations" {
			t.Error("wrong registry path")
		}
		if r.Header.Get("Authorization") == "" {
			t.Error("missing installation credential")
		}
		if err := json.NewDecoder(r.Body).Decode(&last); err != nil {
			t.Error(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	previous := installationHTTPClient
	installationHTTPClient = func() *http.Client { return server.Client() }
	defer func() { installationHTTPClient = previous }()
	root := t.TempDir()
	input := installationTelemetryInput{Root: root, ControlURI: server.URL + "/activate", Event: "INSTALLED",
		PackageType: "server-pos", PlatformTarget: "windows-11-x64", ReleaseVersion: "1.2.3", Force: true}
	if err := reportInstallationTelemetry(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	firstID := last.InstallationID
	if firstID == "" || last.PackageType != "server-pos" || last.PlatformTarget != "windows-11-x64" {
		t.Fatal("incomplete report")
	}
	if _, err := os.ReadFile(filepath.Join(root, "installation-telemetry", "state.json")); err != nil {
		t.Fatal(err)
	}
	input.Event, input.Force = "SEEN", false
	if err := reportInstallationTelemetry(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatal("status transition was not reported")
	}
	if err := reportInstallationTelemetry(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatal("heartbeat was not bounded")
	}
	input.ReleaseVersion = "1.2.4"
	if err := reportInstallationTelemetry(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if requests != 3 || last.InstallationID != firstID {
		t.Fatal("metadata update changed or missed installation identity")
	}
}
