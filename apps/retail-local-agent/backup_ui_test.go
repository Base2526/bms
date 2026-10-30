package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupUIEvidence(t *testing.T) {
	root := t.TempDir()
	b := &licenseUIBridge{root: root, engine: "windows-wsl"}
	if b.backupSnapshot().Status != "not_configured" {
		t.Fatal("missing configuration")
	}
	if err := os.WriteFile(filepath.Join(root, "offhost-backup.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if b.backupSnapshot().Status != "unknown" {
		t.Fatal("missing result is not a pass")
	}
	for _, status := range []string{"passed", "failed"} {
		data, _ := json.Marshal(map[string]any{"status": status, "at": time.Now().UTC(), "output": "private"})
		if err := os.WriteFile(filepath.Join(root, "offhost-backup-status.json"), append([]byte{0xef, 0xbb, 0xbf}, data...), 0600); err != nil {
			t.Fatal(err)
		}
		result := b.backupSnapshot()
		if result.Status != status || result.At == nil {
			t.Fatalf("bad result: %+v", result)
		}
	}
	b.engine = "macos-lima"
	if b.backupSnapshot().Status != "unknown" {
		t.Fatal("unsupported platform is unknown")
	}
}
