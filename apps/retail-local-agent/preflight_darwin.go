//go:build darwin

package main

import (
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
	if runtime.GOARCH != "arm64" {
		result.fail("รองรับเฉพาะ Mac ที่ใช้ Apple Silicon")
	} else {
		result.Target = "macos-15-arm64"
	}
	if major, err := macOSMajorVersion(); err != nil || major < 15 {
		result.fail("ต้องใช้ macOS 15 หรือใหม่กว่า")
	}
	if value, err := sysctlInt("hw.memsize"); err != nil || value < 8*1024*1024*1024 {
		result.fail("ต้องมี RAM อย่างน้อย 8 GiB")
	}
	if value, err := sysctlInt("kern.hv_support"); err != nil || value != 1 {
		result.fail("เครื่องนี้ไม่รองรับ Apple Virtualization Framework")
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		result.fail("อ่านพื้นที่ว่างของ system volume ไม่ได้")
	} else {
		free := uint64(stat.Bavail) * uint64(stat.Bsize)
		if free < 12*1024*1024*1024 {
			result.fail("ต้องมีพื้นที่ว่างอย่างน้อย 12 GiB")
		} else if free < 30*1024*1024*1024 {
			result.warn("แนะนำพื้นที่ว่างอย่างน้อย 30 GiB สำหรับข้อมูล update และ backup")
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
