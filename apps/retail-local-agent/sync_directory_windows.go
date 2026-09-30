//go:build windows

package main

// Windows does not support Sync on a directory handle opened through os.Open. The file itself is
// flushed before each atomic rename, so there is no additional portable directory flush to perform.
func syncDirectory(string) error {
	return nil
}
