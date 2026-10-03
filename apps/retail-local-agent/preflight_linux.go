//go:build linux

package main

import (
	"bufio"
	"fmt"
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
		result.fail("Only Linux x86_64 is supported in this milestone")
	}
	metadata, err := readOSRelease("/etc/os-release")
	if err != nil {
		result.fail("Could not read /etc/os-release")
	} else if metadata["ID"] != "ubuntu" {
		result.fail("Only Ubuntu is supported in this milestone")
	} else {
		switch metadata["VERSION_ID"] {
		case "24.04":
			result.Target = "ubuntu-24.04-lts-x64"
		case "22.04":
			result.Target = "ubuntu-22.04-lts-x64"
			result.warn("Ubuntu 22.04 is a transition target")
		default:
			result.fail("Only Ubuntu 24.04 LTS or 22.04 LTS is supported")
		}
	}
	if pidOne, err := os.ReadFile("/proc/1/comm"); err != nil || strings.TrimSpace(string(pidOne)) != "systemd" {
		result.fail("PID 1 is not systemd")
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		result.fail("systemctl was not found")
	}
	if memoryKiB, err := linuxMemoryKiB(); err != nil {
		result.fail("Could not read RAM size")
	} else if memoryKiB < 8*1024*1024 {
		result.fail(fmt.Sprintf("At least 8 GiB of RAM is required; detected %.1f GiB", float64(memoryKiB)/float64(1024*1024)))
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/var/lib", &stat); err != nil {
		result.fail("Could not read free disk space on /var/lib")
	} else {
		free := uint64(stat.Bavail) * uint64(stat.Bsize)
		if free < 8*1024*1024*1024 {
			result.fail(fmt.Sprintf("Free disk space on /var/lib: %.1f GiB; at least 8 GiB is required", float64(free)/float64(1024*1024*1024)))
		} else if free < 15*1024*1024*1024 {
			result.warn(fmt.Sprintf("Free disk space on /var/lib: %.1f GiB; at least 15 GiB is recommended for updates and backups", float64(free)/float64(1024*1024*1024)))
		}
	}
	if _, err := os.Stat("/sys/fs/cgroup"); err != nil {
		result.fail("Linux cgroup filesystem was not found")
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
