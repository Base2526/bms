package main

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
