package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Secret-free host evidence. Paths, recipients and error messages never reach Web.
type backupUISnapshot struct {
	Status string     `json:"status"`
	At     *time.Time `json:"at,omitempty"`
}

func (b *licenseUIBridge) backupSnapshot() backupUISnapshot {
	unknown := backupUISnapshot{Status: "unknown"}
	if b.engine == "macos-lima" {
		return unknown
	}
	config := filepath.Join(b.root, "offhost-backup.json")
	if b.engine == "linux-native" {
		config = "/etc/bms-retail-local/offhost-backup.json"
	}
	if _, err := os.Lstat(config); err != nil {
		if os.IsNotExist(err) {
			return backupUISnapshot{Status: "not_configured"}
		}
		return unknown
	}
	data, err := readUIFile(filepath.Join(b.root, "offhost-backup-status.json"))
	if err != nil {
		return unknown
	}
	var report struct {
		Status string    `json:"status"`
		At     time.Time `json:"at"`
	}
	// Windows PowerShell 5.1 emits a UTF-8 BOM.
	if json.Unmarshal(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), &report) != nil || report.At.IsZero() || report.At.After(time.Now().Add(time.Minute)) {
		return unknown
	}
	if report.Status != "passed" && report.Status != "failed" {
		return unknown
	}
	return backupUISnapshot{Status: report.Status, At: &report.At}
}
