package harness

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
)

const defaultMaxResultBytes = 32 << 10
const previewBytes = 1 << 10

type ErrorEnvelope = sandbox.ErrorEnvelope
type SerializationWarning = sandbox.SerializationWarning

// ResultEnvelope is the MCP-facing tool-result body for code_mode_run_js.
//
// Wire shape:
//   - result is always present (null if the agent threw).
//   - warnings is omitted on the wire when empty.
//   - truncated is omitted on the wire when false (only signals a non-default state).
//   - error is omitted on the wire when nil (only present on the throw path).
type ResultEnvelope struct {
	Result    json.RawMessage        `json:"result"`
	Warnings  []SerializationWarning `json:"warnings,omitempty"`
	Truncated bool                   `json:"truncated,omitempty"`
	Error     *ErrorEnvelope         `json:"error,omitempty"`
}

func BuildEnvelope(sandboxResult sandbox.ExecuteResult, maxResultBytes int) (ResultEnvelope, error) {
	if maxResultBytes <= 0 {
		maxResultBytes = defaultMaxResultBytes
	}
	if !sandboxResult.OK {
		return ResultEnvelope{
			Result:    json.RawMessage("null"),
			Warnings:  sandboxResult.Warnings,
			Truncated: false,
			Error:     cloneErrorEnvelope(sandboxResult.Error),
		}, nil
	}
	if len(sandboxResult.Result) <= maxResultBytes {
		return ResultEnvelope{Result: sandboxResult.Result, Warnings: sandboxResult.Warnings, Truncated: false, Error: nil}, nil
	}

	truncated, ok, err := structurallyTruncate(sandboxResult.Result, maxResultBytes)
	if err != nil {
		return ResultEnvelope{}, err
	}
	if ok {
		return ResultEnvelope{Result: truncated, Warnings: sandboxResult.Warnings, Truncated: true, Error: nil}, nil
	}
	fallback, err := previewEnvelope(sandboxResult.Result)
	if err != nil {
		return ResultEnvelope{}, err
	}
	return ResultEnvelope{Result: fallback, Warnings: sandboxResult.Warnings, Truncated: true, Error: nil}, nil
}

func cloneErrorEnvelope(err *ErrorEnvelope) *ErrorEnvelope {
	if err == nil {
		return nil
	}
	return &ErrorEnvelope{
		Name:    err.Name,
		Message: err.Message,
		Stack:   err.Stack,
		Cause:   cloneErrorEnvelope(err.Cause),
	}
}

func structurallyTruncate(raw json.RawMessage, maxBytes int) (json.RawMessage, bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, false, fmt.Errorf("empty JSON result")
	}
	switch trimmed[0] {
	case '[':
		items, err := splitJSONArray(trimmed)
		if err != nil {
			return nil, false, err
		}
		for keep := len(items); keep >= 0; keep-- {
			body := joinJSON('[', ']', items[:keep])
			if len(body) <= maxBytes {
				return body, true, nil
			}
		}
	case '{':
		fields, err := splitJSONObject(trimmed)
		if err != nil {
			return nil, false, err
		}
		for keep := len(fields); keep >= 0; keep-- {
			body := joinJSON('{', '}', fields[:keep])
			if len(body) <= maxBytes {
				return body, true, nil
			}
		}
	}
	return nil, false, nil
}

func splitJSONArray(raw []byte) ([]json.RawMessage, error) {
	if !json.Valid(raw) {
		return nil, fmt.Errorf("invalid JSON result")
	}
	inner := bytes.TrimSpace(raw[1 : len(raw)-1])
	if len(inner) == 0 {
		return nil, nil
	}
	return splitTopLevel(inner), nil
}

func splitJSONObject(raw []byte) ([]json.RawMessage, error) {
	if !json.Valid(raw) {
		return nil, fmt.Errorf("invalid JSON result")
	}
	inner := bytes.TrimSpace(raw[1 : len(raw)-1])
	if len(inner) == 0 {
		return nil, nil
	}
	return splitTopLevel(inner), nil
}

func splitTopLevel(raw []byte) []json.RawMessage {
	parts := make([]json.RawMessage, 0)
	start := 0
	depth := 0
	inString := false
	escaped := false
	for i, b := range raw {
		if inString {
			if escaped {
				escaped = false
			} else if b == '\\' {
				escaped = true
			} else if b == '"' {
				inString = false
			}
			continue
		}
		switch b {
		case '"':
			inString = true
		case '[', '{':
			depth++
		case ']', '}':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, bytes.TrimSpace(raw[start:i]))
				start = i + 1
			}
		}
	}
	parts = append(parts, bytes.TrimSpace(raw[start:]))
	return parts
}

func joinJSON(open byte, close byte, parts []json.RawMessage) json.RawMessage {
	var b strings.Builder
	b.WriteByte(open)
	for i, part := range parts {
		if i > 0 {
			b.WriteByte(',')
		}
		b.Write(bytes.TrimSpace(part))
	}
	b.WriteByte(close)
	return json.RawMessage(b.String())
}

func previewEnvelope(raw json.RawMessage) (json.RawMessage, error) {
	preview := string(raw)
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		preview = value
	}
	body, err := json.Marshal(struct {
		Truncated    bool   `json:"__truncated"`
		OriginalSize int    `json:"originalSize"`
		Preview      string `json:"preview"`
	}{
		Truncated:    true,
		OriginalSize: len(raw),
		Preview:      firstUTF8Bytes(preview, previewBytes),
	})
	if err != nil {
		return nil, err
	}
	return body, nil
}

func firstUTF8Bytes(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	cut := limit
	for cut > 0 && !utf8.ValidString(s[:cut]) {
		cut--
	}
	return s[:cut]
}
