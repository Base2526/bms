package main

import "fmt"

type preflightResult struct {
	OK             bool     `json:"ok"`
	Platform       string   `json:"platform"`
	Target         string   `json:"target"`
	Architecture   string   `json:"architecture"`
	RequiresReboot bool     `json:"requiresReboot"`
	Failures       []string `json:"failures"`
	Warnings       []string `json:"warnings"`
}

func (result *preflightResult) fail(message string) {
	result.Failures = append(result.Failures, message)
	result.OK = false
}

func (result *preflightResult) warn(message string) {
	result.Warnings = append(result.Warnings, message)
}

func (result preflightResult) writeHuman() {
	fmt.Printf("BMS Retail Local system check\n")
	fmt.Printf("Platform: %s  Architecture: %s  Target: %s\n", result.Platform, result.Architecture, result.Target)
	for _, message := range result.Warnings {
		fmt.Printf("[WARN] %s\n", message)
	}
	for _, message := range result.Failures {
		fmt.Printf("[FAIL] %s\n", message)
	}
	if result.OK {
		fmt.Println("Result: ready to install")
	} else {
		fmt.Println("Result: cannot install yet. Resolve the issues above, then run Setup again")
	}
}
