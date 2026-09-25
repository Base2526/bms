//go:build windows

package main

import (
	"os/exec"
	"strconv"
)

func processAlive(pid int) bool {
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		"if (Get-Process -Id "+strconv.Itoa(pid)+" -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }")
	return command.Run() == nil
}
