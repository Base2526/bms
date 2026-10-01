package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWSLRuntimeWriteQuoting(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("BMS_TEST_WSL_DISTRO") == "" {
		t.Skip("opt-in integration test requires a disposable WSL test directory")
	}
	distro := os.Getenv("BMS_TEST_WSL_DISTRO")
	if !distroPattern.MatchString(distro) {
		t.Fatal("invalid test distro")
	}
	output, err := exec.Command("wsl.exe", "-d", distro, "--exec", "mktemp", "-d", "/tmp/bms-runtime-write-test.XXXXXXXX").Output()
	if err != nil {
		t.Fatal(err)
	}
	directory := strings.TrimSpace(string(output))
	if !strings.HasPrefix(directory, "/tmp/bms-runtime-write-test.") || strings.ContainsAny(directory, "\r\n") {
		t.Fatal("unexpected test directory")
	}
	destination := directory + "/nested/receipt.json"
	t.Cleanup(func() {
		exec.Command("wsl.exe", "-d", distro, "-u", "root", "--exec", "rm", "-f", destination, destination+".tmp").Run()
		exec.Command("wsl.exe", "-d", distro, "-u", "root", "--exec", "rmdir", directory+"/nested", directory).Run()
	})
	body := []byte("{\"message\":\"ทดสอบ\",\"literal\":\"$HOME\"}\n")
	command, err := runtimeShellCommand("windows-wsl", distro, runtimeWriteScript(destination, "0600", hashBytes(body), int64(len(body))))
	if err != nil {
		t.Fatal(err)
	}
	command.Stdin = bytes.NewReader(body)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("WSL write: %v: %s", err, output)
	}
	got, err := exec.Command("wsl.exe", "-d", distro, "-u", "root", "--exec", "cat", destination).Output()
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("WSL changed bytes: %v %q", err, got)
	}
}

func TestRuntimeWriteInterruptedPipePreservesSecretsAndRetries(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("runtime shell executes in the Linux host or private guest")
	}
	path := filepath.Join(t.TempDir(), ".env")
	old := []byte("original secret file")
	next := []byte("replacement secret file")
	if err := os.WriteFile(path, old, 0600); err != nil {
		t.Fatal(err)
	}
	script := runtimeWriteScript(path, "0600", hashBytes(next), int64(len(next)))
	for _, body := range [][]byte{next[:5], bytes.Repeat([]byte("x"), len(next)), next} {
		command := exec.Command("sh", "-c", script)
		command.Stdin = bytes.NewReader(body)
		output, err := command.CombinedOutput()
		valid := bytes.Equal(body, next)
		if (err == nil) != valid {
			t.Fatalf("unexpected write result: %v %s", err, output)
		}
		got, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		expected := old
		if valid {
			expected = next
		}
		if !bytes.Equal(got, expected) {
			t.Fatal("interrupted transfer replaced the live secret file")
		}
	}
}

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
