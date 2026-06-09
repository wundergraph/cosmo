package calltrace

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

type Recorder interface {
	RecordRequest(toolName string, body []byte)
	RecordResponse(toolName string, body []byte)
}

type Record struct {
	ToolName  string          `json:"tool_name"`
	Timestamp time.Time       `json:"timestamp"`
	Body      json.RawMessage `json:"body"`
}

type NopRecorder struct{}

func (NopRecorder) RecordRequest(string, []byte)  {}
func (NopRecorder) RecordResponse(string, []byte) {}

type FileRecorder struct {
	path string
	now  func() time.Time
	mu   sync.Mutex
}

type Option func(*FileRecorder)

func WithNow(now func() time.Time) Option {
	return func(r *FileRecorder) {
		if now != nil {
			r.now = now
		}
	}
}

func NewFileRecorder(path string, opts ...Option) *FileRecorder {
	recorder := &FileRecorder{
		path: path,
		now:  time.Now,
	}
	for _, opt := range opts {
		opt(recorder)
	}
	return recorder
}

func (r *FileRecorder) RecordRequest(toolName string, body []byte) {
	r.record(toolName, body)
}

func (r *FileRecorder) RecordResponse(toolName string, body []byte) {
	r.record(toolName, body)
}

func (r *FileRecorder) record(toolName string, body []byte) {
	if r == nil || r.path == "" {
		return
	}
	line, err := json.Marshal(Record{
		ToolName:  toolName,
		Timestamp: r.now(),
		Body:      json.RawMessage(body),
	})
	if err != nil {
		return
	}
	line = append(line, '\n')

	r.mu.Lock()
	defer r.mu.Unlock()
	file, err := os.OpenFile(r.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(line)
}

func Enabled(recorder Recorder) bool {
	switch recorder.(type) {
	case nil, NopRecorder, *NopRecorder:
		return false
	default:
		return true
	}
}
