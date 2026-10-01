package main

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
)

const progressPrefix = "BMS_PROGRESS "

type progressEvent struct {
	Phase                   string `json:"phase"`
	Component               string `json:"component,omitempty"`
	CompletedBytes          int64  `json:"completedBytes"`
	TotalBytes              int64  `json:"totalBytes"`
	ComponentCompletedBytes int64  `json:"componentCompletedBytes,omitempty"`
	ComponentTotalBytes     int64  `json:"componentTotalBytes,omitempty"`
	Attempt                 int    `json:"attempt,omitempty"`
	RetryAfterSeconds       int    `json:"retryAfterSeconds,omitempty"`
	Heartbeat               bool   `json:"heartbeat,omitempty"`
	Percent                 int    `json:"percent"`
}

type progressReporter func(progressEvent)

func reportProgress(reporters []progressReporter, event progressEvent) {
	if event.TotalBytes > 0 {
		event.Percent = int(event.CompletedBytes * 100 / event.TotalBytes)
		if event.Percent > 100 {
			event.Percent = 100
		}
	}
	for _, reporter := range reporters {
		if reporter != nil {
			reporter(event)
		}
	}
}

func writeProgressEvent(event progressEvent) {
	encoded, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Printf("%s%s\n", progressPrefix, encoded)
}

type reportingWriter struct {
	w              io.Writer
	phase          string
	component      string
	completed      int64
	total          int64
	reporters      []progressReporter
	lastReport     time.Time
	reportInterval time.Duration
}

func (writer *reportingWriter) Write(buffer []byte) (int, error) {
	written, err := writer.w.Write(buffer)
	writer.completed += int64(written)
	now := time.Now()
	if now.Sub(writer.lastReport) >= writer.reportInterval || writer.completed >= writer.total {
		reportProgress(writer.reporters, progressEvent{
			Phase: writer.phase, Component: writer.component,
			CompletedBytes: writer.completed, TotalBytes: writer.total,
		})
		writer.lastReport = now
	}
	return written, err
}

type reportingReader struct {
	r              io.Reader
	phase          string
	component      string
	completed      int64
	total          int64
	reporters      []progressReporter
	lastReport     time.Time
	reportInterval time.Duration
}

func (reader *reportingReader) Read(buffer []byte) (int, error) {
	read, err := reader.r.Read(buffer)
	reader.completed += int64(read)
	now := time.Now()
	if now.Sub(reader.lastReport) >= reader.reportInterval || reader.completed >= reader.total {
		reportProgress(reader.reporters, progressEvent{
			Phase: reader.phase, Component: reader.component,
			CompletedBytes: reader.completed, TotalBytes: reader.total,
		})
		reader.lastReport = now
	}
	return read, err
}
