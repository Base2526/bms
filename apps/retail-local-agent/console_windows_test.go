//go:build windows

package main

import "testing"

func TestDownloadConsoleModePreservesOtherInputFlags(t *testing.T) {
	for mode := uint32(0); mode < 1024; mode++ {
		got := downloadConsoleMode(mode)
		if got&0x0040 != 0 || got&0x0080 == 0 || got&^0x00c0 != mode&^0x00c0 {
			t.Fatalf("mode %#x became %#x", mode, got)
		}
	}
}

func TestConsoleSelectionGuardWorksWithRedirectedTestOutput(t *testing.T) {
	restore := preventConsoleSelectionPause()
	restore()
}
