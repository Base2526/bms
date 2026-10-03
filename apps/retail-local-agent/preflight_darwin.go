//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

func platformPreflight() preflightResult {
	result := preflightResult{
		OK: true, Platform: "darwin", Target: "unsupported", Architecture: runtime.GOARCH,
		Failures: []string{}, Warnings: []string{},
	}
	switch runtime.GOARCH {
	case "arm64":
		result.Target = "macos-15-arm64"
	case "amd64":
		result.Target = "macos-15-x64"
	default:
		result.fail(fmt.Sprintf("Only Apple Silicon (arm64) or Intel (x64) Macs are supported; detected %s", runtime.GOARCH))
	}
	if major, err := macOSMajorVersion(); err != nil {
		result.fail("Could not read macOS version")
	} else if major < 15 {
		result.fail(fmt.Sprintf("macOS 15 or later is required; detected macOS %d", major))
	}
	if value, err := sysctlInt("hw.memsize"); err != nil {
		result.fail("Could not read RAM size")
	} else if value < 8*1024*1024*1024 {
		result.fail(fmt.Sprintf("At least 8 GiB of RAM is required; detected %.1f GiB", float64(value)/float64(1024*1024*1024)))
	}
	if value, err := sysctlInt("kern.hv_support"); err != nil || value != 1 {
		result.fail("This computer does not support Apple Virtualization Framework")
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		result.fail("Could not read free space on the system volume")
	} else {
		free := uint64(stat.Bavail) * uint64(stat.Bsize)
		if free < 12*1024*1024*1024 {
			result.fail(fmt.Sprintf("Free disk space: %.1f GiB; at least 12 GiB is required and 30 GiB is recommended", float64(free)/float64(1024*1024*1024)))
		} else if free < 30*1024*1024*1024 {
			result.warn(fmt.Sprintf("Free disk space: %.1f GiB; at least 30 GiB is recommended for data, updates, and backups", float64(free)/float64(1024*1024*1024)))
		}
	}
	result.OK = len(result.Failures) == 0
	return result
}

func macOSMajorVersion() (int64, error) {
	output, err := exec.Command("sw_vers", "-productVersion").Output()
	if err != nil {
		return 0, err
	}
	major := strings.SplitN(strings.TrimSpace(string(output)), ".", 2)[0]
	return strconv.ParseInt(major, 10, 64)
}

func sysctlInt(name string) (int64, error) {
	output, err := exec.Command("sysctl", "-n", name).Output()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(string(output)), 10, 64)
}
