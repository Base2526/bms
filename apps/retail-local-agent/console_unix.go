//go:build !windows

package main

func preventConsoleSelectionPause() func() { return func() {} }
