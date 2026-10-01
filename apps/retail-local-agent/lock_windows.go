//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"unsafe"
)

func lockInstallFile(file *os.File) error {
	var overlapped syscall.Overlapped
	ok, _, err := syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx").Call(
		file.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	if ok == 0 {
		return err
	}
	return nil
}

func processAlive(pid int) bool {
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		"if (Get-Process -Id "+strconv.Itoa(pid)+" -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }")
	return command.Run() == nil
}
