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
		result.fail(fmt.Sprintf("รองรับเฉพาะ Mac Apple Silicon (arm64) หรือ Intel (x64); พบ %s", runtime.GOARCH))
	}
	if major, err := macOSMajorVersion(); err != nil {
		result.fail("อ่านเวอร์ชัน macOS ไม่ได้")
	} else if major < 15 {
		result.fail(fmt.Sprintf("ต้องใช้ macOS 15 หรือใหม่กว่า; พบ macOS %d", major))
	}
	if value, err := sysctlInt("hw.memsize"); err != nil {
		result.fail("อ่านขนาด RAM ไม่ได้")
	} else if value < 8*1024*1024*1024 {
		result.fail(fmt.Sprintf("ต้องมี RAM อย่างน้อย 8 GiB; พบ %.1f GiB", float64(value)/float64(1024*1024*1024)))
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
			result.fail(fmt.Sprintf("พื้นที่ว่างปัจจุบัน %.1f GiB; ต้องมีอย่างน้อย 12 GiB และแนะนำ 30 GiB", float64(free)/float64(1024*1024*1024)))
		} else if free < 30*1024*1024*1024 {
			result.warn(fmt.Sprintf("พื้นที่ว่างปัจจุบัน %.1f GiB; แนะนำอย่างน้อย 30 GiB สำหรับข้อมูล update และ backup", float64(free)/float64(1024*1024*1024)))
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
