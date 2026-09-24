//go:build darwin

package main

import "runtime"

func platformPreflight() preflightResult {
	return preflightResult{
		OK: false, Platform: "darwin", Target: "unsupported", Architecture: runtime.GOARCH,
		Failures: []string{"macOS local server ยังไม่อยู่ใน Managed Runtime milestone แรก"}, Warnings: []string{},
	}
}
