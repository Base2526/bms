package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeWriteRejectsPathOutsidePrivateRoot(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	if err := writeRuntimeFile("not-an-engine", "BMSRuntime", source, "/etc/shadow", "0600"); err == nil {
		t.Fatal("outside destination was accepted")
	}
}

func TestEngineLoadRejectsMutableOrMalformedIdentity(t *testing.T) {
	if err := loadAndVerifyImage("linux-native", "", "missing", "latest", "sha256:"+string(make([]byte, 64))); err == nil {
		t.Fatal("malformed image identity was accepted")
	}
}

func TestSafeRuntimePath(t *testing.T) {
	valid, err := safeRuntimePath("/var/lib/bms-retail-local/backups/shop.age")
	if err != nil || valid != "/var/lib/bms-retail-local/backups/shop.age" {
		t.Fatalf("valid runtime path rejected: %q %v", valid, err)
	}
	for _, input := range []string{"/etc/shadow", "/var/lib/bms-retail-local/../../etc/shadow", "relative"} {
		if _, err := safeRuntimePath(input); err == nil {
			t.Fatalf("unsafe path accepted: %s", input)
		}
	}
}

func TestRuntimeControlInstallIsAllowListed(t *testing.T) {
	if err := installRuntimeControl("windows-wsl", "BMSRuntime", "missing", "../../evil"); err == nil {
		t.Fatal("unexpected runtime control name was accepted")
	}
}

func TestRuntimeControlNormalizesWindowsLineEndings(t *testing.T) {
	contents, err := normalizeRuntimeControl([]byte("#!/bin/sh\r\nprintf 'line-endings-ok\\n'\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(contents, []byte{'\r'}) || !bytes.HasPrefix(contents, []byte("#!/bin/sh\n")) {
		t.Fatalf("runtime control was not normalized: %q", contents)
	}
}

func TestQuoteShellArgument(t *testing.T) {
	input := `/var/lib/bms-retail-local/it's $(not-a-command)`
	quoted := quoteShellArgument(input)
	if quoted != `'/var/lib/bms-retail-local/it'"'"'s $(not-a-command)'` {
		t.Fatalf("unexpected shell quoting: %s", quoted)
	}
}

func TestLimaCtlPathRequiresAbsoluteOverride(t *testing.T) {
	original := os.Getenv("BMS_LIMACTL_PATH")
	t.Cleanup(func() { _ = os.Setenv("BMS_LIMACTL_PATH", original) })
	if err := os.Setenv("BMS_LIMACTL_PATH", "relative/limactl"); err != nil {
		t.Fatal(err)
	}
	if _, err := limaCtlPath(); err == nil {
		t.Fatal("relative BMS_LIMACTL_PATH was accepted")
	}
}
