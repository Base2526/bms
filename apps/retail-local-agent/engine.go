package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var (
	distroPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	modePattern   = regexp.MustCompile(`^0[0-7]{3}$`)
)

func engineCommand(engine, distro string, args ...string) (*exec.Cmd, error) {
	switch engine {
	case "windows-wsl":
		if runtime.GOOS != "windows" {
			return nil, errors.New("windows-wsl engine ใช้ได้เฉพาะ Windows")
		}
		if !distroPattern.MatchString(distro) {
			return nil, errors.New("ชื่อ WSL distribution ไม่ถูกต้อง")
		}
		prefix := []string{"-d", distro, "-u", "root", "--", "docker"}
		return exec.Command("wsl.exe", append(prefix, args...)...), nil
	case "linux-native":
		if runtime.GOOS != "linux" {
			return nil, errors.New("linux-native engine ใช้ได้เฉพาะ Linux")
		}
		return exec.Command("docker", args...), nil
	default:
		return nil, fmt.Errorf("engine %q ไม่รองรับ", engine)
	}
}

func runtimeShellCommand(engine, distro, script string, args ...string) (*exec.Cmd, error) {
	switch engine {
	case "windows-wsl":
		if runtime.GOOS != "windows" || !distroPattern.MatchString(distro) {
			return nil, errors.New("windows-wsl runtime ไม่ถูกต้อง")
		}
		prefix := []string{"-d", distro, "-u", "root", "--", "sh", "-c", script, "bms-runtime"}
		return exec.Command("wsl.exe", append(prefix, args...)...), nil
	case "linux-native":
		if runtime.GOOS != "linux" {
			return nil, errors.New("linux-native runtime ใช้ได้เฉพาะ Linux")
		}
		prefix := []string{"-c", script, "bms-runtime"}
		return exec.Command("sh", append(prefix, args...)...), nil
	default:
		return nil, fmt.Errorf("engine %q ไม่รองรับ", engine)
	}
}

func loadAndVerifyImage(engine, distro, artifact, imageRef, expectedDigest string) error {
	if !imageRefPattern.MatchString(imageRef) || !digestPattern.MatchString(expectedDigest) {
		return errors.New("image reference/digest ไม่ถูกต้อง")
	}
	file, err := os.Open(artifact)
	if err != nil {
		return err
	}
	defer file.Close()
	load, err := engineCommand(engine, distro, "load")
	if err != nil {
		return err
	}
	load.Stdin = file
	var loadError bytes.Buffer
	load.Stderr = &loadError
	load.Stdout = io.Discard
	if err := load.Run(); err != nil {
		return fmt.Errorf("โหลด image ไม่สำเร็จ: %s", strings.TrimSpace(loadError.String()))
	}
	inspect, err := engineCommand(engine, distro, "image", "inspect", "--format", "{{.Id}}", imageRef)
	if err != nil {
		return err
	}
	output, err := inspect.Output()
	if err != nil {
		return fmt.Errorf("ตรวจ image id ไม่สำเร็จ: %w", err)
	}
	actual := strings.TrimSpace(string(output))
	if actual != expectedDigest {
		return fmt.Errorf("image id ไม่ตรงสำหรับ %s: ต้องการ %s ได้ %s", imageRef, expectedDigest, actual)
	}
	return nil
}

func writeRuntimeFile(engine, distro, source, destination, mode string) error {
	cleanDestination, err := safeRuntimePath(destination)
	if err != nil {
		return err
	}
	if !modePattern.MatchString(mode) {
		return errors.New("runtime file mode ไม่ถูกต้อง")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	command, err := runtimeShellCommand(engine, distro,
		`set -eu; umask 077; mkdir -p "$(dirname "$1")"; temporary="$1.tmp.$$"; cat > "$temporary"; chmod "$2" "$temporary"; mv -f "$temporary" "$1"`,
		cleanDestination, mode)
	if err != nil {
		return err
	}
	command.Stdin = input
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("เขียน runtime file ไม่สำเร็จ: %s", strings.TrimSpace(stderr.String()))
	}
	return nil
}

func readRuntimeFile(engine, distro, source, destination string) error {
	cleanSource, err := safeRuntimePath(source)
	if err != nil {
		return err
	}
	if engine != "windows-wsl" {
		return errors.New("runtime-read ใช้สำหรับส่งออกไฟล์จาก private Windows WSL เท่านั้น")
	}
	command, err := runtimeShellCommand(engine, distro, `set -eu; test -f "$1"; test ! -L "$1"; cat -- "$1"`, cleanSource)
	if err != nil {
		return err
	}
	destination = filepath.Clean(destination)
	if _, err := os.Stat(destination); err == nil {
		return errors.New("destination มีอยู่แล้ว")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	command.Stdout = output
	var stderr bytes.Buffer
	command.Stderr = &stderr
	runErr := command.Run()
	closeErr := output.Close()
	if runErr != nil || closeErr != nil {
		_ = os.Remove(destination)
		if runErr != nil {
			return fmt.Errorf("อ่าน runtime file ไม่สำเร็จ: %s", strings.TrimSpace(stderr.String()))
		}
		return closeErr
	}
	return nil
}

func safeRuntimePath(input string) (string, error) {
	clean := filepath.ToSlash(filepath.Clean(input))
	if clean == "/var/lib/bms-retail-local" || strings.HasPrefix(clean, "/var/lib/bms-retail-local/") {
		return clean, nil
	}
	return "", errors.New("runtime path อยู่นอก /var/lib/bms-retail-local")
}
