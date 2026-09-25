//go:build windows

package main

import (
	"encoding/json"
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
		result.fail("รองรับเฉพาะ Windows x64 ใน milestone แรก")
	}
	facts, err := collectWindowsFacts()
	if err != nil {
		result.fail("อ่านข้อมูล Windows ไม่ได้: " + err.Error())
		return result
	}
	switch {
	case facts.Build >= 22000:
		result.Target = "windows-11-x64"
	case facts.Build == 19044 && strings.Contains(facts.Caption, "Windows 10 IoT Enterprise LTSC 2021"):
		result.Target = "windows-10-iot-enterprise-ltsc-2021-x64"
	case facts.Build == 19045:
		result.Target = "windows-10-22h2-esu-x64"
		result.warn("Windows 10 22H2 ต้องมีหลักฐาน ESU ที่ยังใช้งานอยู่ก่อนรับรอง production")
	default:
		result.fail("Windows build ไม่อยู่ใน support matrix ของ Managed Runtime")
	}
	if facts.MemoryGiB < 8 {
		result.fail("ต้องมี RAM อย่างน้อย 8 GiB")
	}
	if facts.FreeGiB < 8 {
		result.fail("ต้องมีพื้นที่ว่างอย่างน้อย 8 GiB")
	} else if facts.FreeGiB < 15 {
		result.warn("ควรมีพื้นที่ว่างอย่างน้อย 15 GiB สำหรับ update และ backup")
	}
	if facts.VirtualizationFirmware != nil && !*facts.VirtualizationFirmware {
		result.fail("ยังไม่ได้เปิด hardware virtualization ใน BIOS/UEFI")
	} else if facts.VirtualizationFirmware == nil {
		result.warn("ตรวจ virtualization จาก firmware ไม่ได้; installer ต้องยืนยันด้วย WSL2")
	}
	if !facts.WSLEnabled || !facts.VirtualMachinePlatform {
		result.RequiresReboot = true
		result.warn("installer ต้องเปิด WSL และ Virtual Machine Platform แล้ว restart")
	}
	result.OK = len(result.Failures) == 0
	return result
}

func collectWindowsFacts() (windowsFacts, error) {
	script := `$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$os.SystemDrive+"'"); $cpu=@(Get-CimInstance Win32_Processor); $virt=@($cpu|ForEach-Object {$_.VirtualizationFirmwareEnabled}|Where-Object {$null -ne $_}); $wsl=(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).State -eq 'Enabled'; $vmp=(Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State -eq 'Enabled'; [pscustomobject]@{caption=$os.Caption;build=[int]$os.BuildNumber;memoryGiB=[math]::Round($os.TotalVisibleMemorySize/1MB,1);freeGiB=[math]::Round($disk.FreeSpace/1GB,1);virtualizationFirmware=if($virt.Count){[bool]($true -in $virt)}else{$null};wslEnabled=$wsl;virtualMachinePlatform=$vmp}|ConvertTo-Json -Compress`
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := command.Output()
	if err != nil {
		return windowsFacts{}, err
	}
	var facts windowsFacts
	if err := json.Unmarshal(output, &facts); err != nil {
		return windowsFacts{}, err
	}
	return facts, nil
}
