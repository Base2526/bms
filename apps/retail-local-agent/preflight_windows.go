//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

type windowsFacts struct {
	Caption                string  `json:"caption"`
	Build                  int     `json:"build"`
	MemoryGiB              float64 `json:"memoryGiB"`
	FreeGiB                float64 `json:"freeGiB"`
	VirtualizationFirmware *bool   `json:"virtualizationFirmware"`
	WSLEnabled             bool    `json:"wslEnabled"`
	VirtualMachinePlatform bool    `json:"virtualMachinePlatform"`
}

func platformPreflight() preflightResult {
	result := preflightResult{OK: true, Platform: "windows", Target: "unsupported", Architecture: runtime.GOARCH, Failures: []string{}, Warnings: []string{}}
	if runtime.GOARCH != "amd64" {
		result.fail("Only Windows x64 is supported in this milestone")
	}
	facts, err := collectWindowsFacts()
	if err != nil {
		result.fail("Could not read Windows system information: " + err.Error())
		return result
	}
	switch {
	case facts.Build >= 22000:
		result.Target = "windows-11-x64"
	case facts.Build == 19044 && strings.Contains(facts.Caption, "Windows 10 IoT Enterprise LTSC 2021"):
		result.Target = "windows-10-iot-enterprise-ltsc-2021-x64"
	case facts.Build == 19045:
		result.Target = "windows-10-22h2-esu-x64"
		result.warn("Windows 10 22H2 requires evidence of current ESU coverage before production approval")
	default:
		result.fail("This Windows build is not in the Managed Runtime support matrix")
	}
	if facts.MemoryGiB < 8 {
		result.fail(fmt.Sprintf("At least 8 GiB of RAM is required; detected %.1f GiB", facts.MemoryGiB))
	}
	if facts.FreeGiB < 8 {
		result.fail(fmt.Sprintf("Free disk space: %.1f GiB; at least 8 GiB is required", facts.FreeGiB))
	} else if facts.FreeGiB < 15 {
		result.warn(fmt.Sprintf("Free disk space: %.1f GiB; at least 15 GiB is recommended for updates and backups", facts.FreeGiB))
	}
	if facts.VirtualizationFirmware != nil && !*facts.VirtualizationFirmware {
		if facts.WSLEnabled && facts.VirtualMachinePlatform {
			result.warn("CIM reports virtualization as disabled, but WSL is available; setup will verify it during WSL2 import")
		} else {
			result.fail("Hardware virtualization is not enabled in BIOS/UEFI")
		}
	} else if facts.VirtualizationFirmware == nil {
		result.warn("Could not detect firmware virtualization; setup must verify WSL2")
	}
	if !facts.WSLEnabled || !facts.VirtualMachinePlatform {
		result.RequiresReboot = true
		result.warn("Setup needs to enable WSL and Virtual Machine Platform, then restart Windows")
	}
	result.OK = len(result.Failures) == 0
	return result
}

func collectWindowsFacts() (windowsFacts, error) {
	// Get-WindowsOptionalFeature requires elevation on otherwise supported machines. Preflight is
	// intentionally read-only, so use a working WSL installation as the non-elevated fallback and
	// leave the later import command as the authoritative WSL2 check.
	script := `$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$os.SystemDrive+"'"); $cpu=@(Get-CimInstance Win32_Processor); $virt=@($cpu|ForEach-Object {$_.VirtualizationFirmwareEnabled}|Where-Object {$null -ne $_}); try{$wsl=(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).State -eq 'Enabled';$vmp=(Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State -eq 'Enabled'}catch{& wsl.exe --status *> $null;$wslReady=$LASTEXITCODE -eq 0;$wsl=$wslReady;$vmp=$wslReady}; [pscustomobject]@{caption=$os.Caption;build=[int]$os.BuildNumber;memoryGiB=[math]::Round($os.TotalVisibleMemorySize/1MB,1);freeGiB=[math]::Round($disk.FreeSpace/1GB,1);virtualizationFirmware=if($virt.Count){[bool]($true -in $virt)}else{$null};wslEnabled=$wsl;virtualMachinePlatform=$vmp}|ConvertTo-Json -Compress`
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return windowsFacts{}, errors.New(message)
	}
	var facts windowsFacts
	if err := json.Unmarshal(output, &facts); err != nil {
		return windowsFacts{}, err
	}
	return facts, nil
}
