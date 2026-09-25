//go:build linux

package main

import (
	"bufio"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

func platformPreflight() preflightResult {
	result := preflightResult{OK: true, Platform: "linux", Target: "unsupported", Architecture: runtime.GOARCH, Failures: []string{}, Warnings: []string{}}
	if runtime.GOARCH != "amd64" {
		result.fail("รองรับเฉพาะ Linux x86_64 ใน milestone แรก")
	}
	metadata, err := readOSRelease("/etc/os-release")
	if err != nil {
		result.fail("อ่าน /etc/os-release ไม่ได้")
	} else if metadata["ID"] != "ubuntu" {
		result.fail("milestone แรกรองรับ Ubuntu เท่านั้น")
	} else {
		switch metadata["VERSION_ID"] {
		case "24.04":
			result.Target = "ubuntu-24.04-lts-x64"
		case "22.04":
			result.Target = "ubuntu-22.04-lts-x64"
			result.warn("Ubuntu 22.04 เป็น transition target")
		default:
			result.fail("รองรับ Ubuntu 24.04 LTS หรือ 22.04 LTS เท่านั้น")
		}
	}
	if pidOne, err := os.ReadFile("/proc/1/comm"); err != nil || strings.TrimSpace(string(pidOne)) != "systemd" {
		result.fail("PID 1 ไม่ใช่ systemd")
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		result.fail("ไม่พบ systemctl")
	}
	if memoryKiB, err := linuxMemoryKiB(); err != nil || memoryKiB < 8*1024*1024 {
		result.fail("ต้องมี RAM อย่างน้อย 8 GiB")
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/var/lib", &stat); err != nil {
		result.fail("อ่านพื้นที่ว่างของ /var/lib ไม่ได้")
	} else {
		free := uint64(stat.Bavail) * uint64(stat.Bsize)
		if free < 8*1024*1024*1024 {
			result.fail("ต้องมีพื้นที่ว่างอย่างน้อย 8 GiB บน filesystem ของ /var/lib")
		} else if free < 15*1024*1024*1024 {
			result.warn("ควรมีพื้นที่ว่างอย่างน้อย 15 GiB สำหรับ update และ backup")
		}
	}
	if _, err := os.Stat("/sys/fs/cgroup"); err != nil {
		result.fail("ไม่พบ Linux cgroup filesystem")
	}
	result.OK = len(result.Failures) == 0
	return result
}

func readOSRelease(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			values[parts[0]] = strings.Trim(parts[1], `"'`)
		}
	}
	return values, scanner.Err()
}

func linuxMemoryKiB() (int64, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			return strconv.ParseInt(fields[1], 10, 64)
		}
	}
	return 0, scanner.Err()
}
