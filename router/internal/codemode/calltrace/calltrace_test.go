package calltrace

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileRecorderWritesRequestAndResponseJSONL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "call-trace.jsonl")
	now := time.Date(2026, 5, 4, 10, 30, 0, 0, time.UTC)
	recorder := NewFileRecorder(path, WithNow(func() time.Time { return now }))

	recorder.RecordRequest("code_mode_run_js", []byte(`{"source":"async () => 1"}`))
	recorder.RecordResponse("code_mode_run_js", []byte(`{"content":[{"type":"text","text":"1"}]}`))

	file, err := os.Open(path)
	require.NoError(t, err)
	defer file.Close()

	var got []Record
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record Record
		require.NoError(t, json.Unmarshal(scanner.Bytes(), &record))
		got = append(got, record)
	}
	require.NoError(t, scanner.Err())
	assert.Equal(t, []Record{
		{
			ToolName:  "code_mode_run_js",
			Timestamp: now,
			Body:      json.RawMessage(`{"source":"async () =\u003e 1"}`),
		},
		{
			ToolName:  "code_mode_run_js",
			Timestamp: now,
			Body:      json.RawMessage(`{"content":[{"type":"text","text":"1"}]}`),
		},
	}, got)
}

func TestNopRecorderIsDisabled(t *testing.T) {
	assert.Equal(t, false, Enabled(NopRecorder{}))
}
