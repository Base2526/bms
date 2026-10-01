//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var consoleKernel = syscall.NewLazyDLL("kernel32.dll")
var getConsoleMode = consoleKernel.NewProc("GetConsoleMode")
var setConsoleMode = consoleKernel.NewProc("SetConsoleMode")

func downloadConsoleMode(mode uint32) uint32 {
	return (mode | 0x0080) &^ 0x0040 // ENABLE_EXTENDED_FLAGS without ENABLE_QUICK_EDIT_MODE.
}

func preventConsoleSelectionPause() func() {
	// PowerShell redirects agent output; CONIN$ still addresses its shared console.
	name, _ := syscall.UTF16PtrFromString("CONIN$")
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return func() {}
	}
	var original uint32
	ok, _, _ := getConsoleMode.Call(uintptr(handle), uintptr(unsafe.Pointer(&original)))
	if ok == 0 {
		syscall.CloseHandle(handle)
		return func() {}
	}
	ok, _, _ = setConsoleMode.Call(uintptr(handle), uintptr(downloadConsoleMode(original)))
	return func() {
		if ok != 0 {
			setConsoleMode.Call(uintptr(handle), uintptr(original))
		}
		syscall.CloseHandle(handle)
	}
}
