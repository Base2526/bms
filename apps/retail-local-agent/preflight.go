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
	fmt.Printf("ตรวจสอบเครื่องสำหรับ BMS Retail Local\n")
	fmt.Printf("ระบบ: %s  สถาปัตยกรรม: %s  เป้าหมาย: %s\n", result.Platform, result.Architecture, result.Target)
	for _, message := range result.Warnings {
		fmt.Printf("[คำแนะนำ] %s\n", message)
	}
	for _, message := range result.Failures {
		fmt.Printf("[ต้องแก้ไข] %s\n", message)
	}
	if result.OK {
		fmt.Println("ผลตรวจ: พร้อมติดตั้ง")
	} else {
		fmt.Println("ผลตรวจ: ยังติดตั้งไม่ได้ กรุณาแก้ไขรายการด้านบนแล้วเปิด Setup อีกครั้ง")
	}
}
