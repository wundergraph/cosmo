package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type advisorDeferRun struct {
	initialAt  time.Duration
	terminalAt time.Duration
	closedAt   time.Duration
	// A directive label can identify multiple pending instances below a list.
	// Its arrival is the latest completion across all of those instances.
	arrivals map[string]time.Duration
}

type advisorDeferEnvelope struct {
	Data    json.RawMessage `json:"data"`
	Errors  json.RawMessage `json:"errors"`
	HasNext *bool           `json:"hasNext"`
	Pending []struct {
		ID    string          `json:"id"`
		Path  json.RawMessage `json:"path"`
		Label string          `json:"label"`
	} `json:"pending"`
	Incremental []struct {
		ID      string          `json:"id"`
		Data    json.RawMessage `json:"data"`
		Items   json.RawMessage `json:"items"`
		SubPath json.RawMessage `json:"subPath"`
		Errors  json.RawMessage `json:"errors"`
	} `json:"incremental"`
	Completed []struct {
		ID     string          `json:"id"`
		Errors json.RawMessage `json:"errors"`
	} `json:"completed"`
}

type advisorPendingDefer struct {
	label     string
	path      string
	delivered bool
	completed bool
}

type advisorPendingIdentity struct {
	label string
	path  string
}

func parseAdvisorDeferSegments(segments []loopbackSegment) (*advisorDeferRun, error) {
	if len(segments) == 0 {
		return nil, fmt.Errorf("defer advisor stream has no data parts")
	}

	dataParts := make([]json.RawMessage, 0, len(segments)-1)
	dataTimes := make([]time.Duration, 0, len(segments)-1)
	sawClose := false
	for i, segment := range segments {
		payload, terminal, err := extractDeferPartJSON(segment.body)
		if err != nil {
			return nil, fmt.Errorf("defer advisor multipart segment %d is invalid: %w", i+1, err)
		}
		if terminal {
			if i != len(segments)-1 {
				return nil, fmt.Errorf("defer advisor close-only segment must be last")
			}
			sawClose = true
			continue
		}
		if len(dataParts) == 0 && !bytes.HasPrefix(segment.body, []byte(deferFirstPartHeader)) {
			return nil, fmt.Errorf("defer advisor first data segment has no opening boundary")
		}
		if len(dataParts) != 0 && bytes.HasPrefix(segment.body, []byte(deferFirstPartHeader)) {
			return nil, fmt.Errorf("defer advisor data segment %d repeats the opening boundary", len(dataParts)+1)
		}
		dataParts = append(dataParts, payload)
		dataTimes = append(dataTimes, segment.at)
	}
	if !sawClose {
		return nil, fmt.Errorf("defer advisor stream is missing its close-only segment")
	}
	if len(dataParts) == 0 {
		return nil, fmt.Errorf("defer advisor stream has no data parts")
	}
	for i, segment := range segments {
		if segment.at < 0 {
			return nil, fmt.Errorf("defer advisor multipart segment timestamps must not be negative")
		}
		if i != 0 && segment.at < segments[i-1].at {
			return nil, fmt.Errorf("defer advisor multipart segment timestamps are not monotonic")
		}
	}

	run := &advisorDeferRun{
		initialAt: dataTimes[0],
		closedAt:  segments[len(segments)-1].at,
		arrivals:  make(map[string]time.Duration),
	}
	pendingByID := make(map[string]*advisorPendingDefer)
	pendingIdentities := make(map[advisorPendingIdentity]string)
	outstanding := 0
	terminalSeen := false

	for i, payload := range dataParts {
		partNumber := i + 1
		if terminalSeen {
			return nil, fmt.Errorf("defer advisor multipart part %d appears after hasNext false", partNumber)
		}

		var envelope advisorDeferEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			return nil, fmt.Errorf("defer advisor failed to parse multipart part %d: %w", partNumber, err)
		}
		if envelope.HasNext == nil {
			return nil, fmt.Errorf("defer advisor multipart part %d has no hasNext value", partNumber)
		}
		if partNumber == 1 {
			if envelope.Data == nil {
				return nil, fmt.Errorf("defer advisor multipart part 1 has no data value")
			}
			if !advisorGraphQLDataValid(envelope.Data) {
				return nil, fmt.Errorf("defer advisor multipart part 1 data must be an object or null")
			}
			if len(envelope.Incremental) != 0 || len(envelope.Completed) != 0 {
				return nil, fmt.Errorf("defer advisor multipart part 1 contains incremental lifecycle entries")
			}
		} else if envelope.Data != nil {
			return nil, fmt.Errorf("defer advisor multipart part %d repeats the top-level data value", partNumber)
		}

		hasErrors, err := advisorRawErrorsPresent(envelope.Errors)
		if err != nil {
			return nil, fmt.Errorf("defer advisor multipart part %d has invalid errors: %w", partNumber, err)
		}
		if hasErrors {
			return nil, fmt.Errorf("defer advisor multipart part %d contains GraphQL errors", partNumber)
		}

		for _, pending := range envelope.Pending {
			if pending.ID == "" {
				return nil, fmt.Errorf("defer advisor multipart part %d has an empty pending id", partNumber)
			}
			if _, exists := pendingByID[pending.ID]; exists {
				return nil, fmt.Errorf("defer advisor multipart part %d repeats pending id %q", partNumber, pending.ID)
			}
			if pending.Label == "" {
				return nil, fmt.Errorf("defer advisor multipart part %d pending id %q has no label", partNumber, pending.ID)
			}
			path, err := advisorPendingPath(pending.Path)
			if err != nil {
				return nil, fmt.Errorf("defer advisor multipart part %d pending id %q %w", partNumber, pending.ID, err)
			}
			identity := advisorPendingIdentity{label: pending.Label, path: path}
			if _, exists := pendingIdentities[identity]; exists {
				return nil, fmt.Errorf("defer advisor multipart part %d repeats pending label %q at path %s", partNumber, pending.Label, path)
			}
			pendingByID[pending.ID] = &advisorPendingDefer{label: pending.Label, path: path}
			pendingIdentities[identity] = pending.ID
			outstanding++
		}

		for incrementalIndex, incremental := range envelope.Incremental {
			pending, exists := pendingByID[incremental.ID]
			if !exists {
				return nil, fmt.Errorf("defer advisor multipart part %d patches unknown pending id %q", partNumber, incremental.ID)
			}
			if pending.completed {
				return nil, fmt.Errorf("defer advisor multipart part %d patches completed pending id %q", partNumber, incremental.ID)
			}
			hasErrors, err := advisorRawErrorsPresent(incremental.Errors)
			if err != nil {
				return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d has invalid errors: %w", partNumber, incrementalIndex+1, err)
			}
			if hasErrors {
				return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d contains GraphQL errors", partNumber, incrementalIndex+1)
			}
			if incremental.Items != nil {
				return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d contains stream items", partNumber, incrementalIndex+1)
			}
			if incremental.Data == nil {
				return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d has no data value", partNumber, incrementalIndex+1)
			}
			if !advisorGraphQLDataValid(incremental.Data) {
				return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d data must be an object or null", partNumber, incrementalIndex+1)
			}
			if incremental.SubPath != nil {
				if _, err := advisorPendingPath(incremental.SubPath); err != nil {
					return nil, fmt.Errorf("defer advisor multipart part %d incremental item %d has invalid subPath: %w", partNumber, incrementalIndex+1, err)
				}
			}
			pending.delivered = true
		}

		for completionIndex, completion := range envelope.Completed {
			pending, exists := pendingByID[completion.ID]
			if !exists {
				return nil, fmt.Errorf("defer advisor multipart part %d completes unknown pending id %q", partNumber, completion.ID)
			}
			if pending.completed {
				return nil, fmt.Errorf("defer advisor multipart part %d completes pending id %q more than once", partNumber, completion.ID)
			}
			hasErrors, err := advisorRawErrorsPresent(completion.Errors)
			if err != nil {
				return nil, fmt.Errorf("defer advisor multipart part %d completion %d has invalid errors: %w", partNumber, completionIndex+1, err)
			}
			if hasErrors {
				return nil, fmt.Errorf("defer advisor multipart part %d completion %d contains GraphQL errors", partNumber, completionIndex+1)
			}
			if !pending.delivered {
				return nil, fmt.Errorf("defer advisor multipart part %d completes pending id %q before delivering data", partNumber, completion.ID)
			}
			pending.completed = true
			outstanding--
			if arrivedAt, exists := run.arrivals[pending.label]; !exists || dataTimes[i] > arrivedAt {
				run.arrivals[pending.label] = dataTimes[i]
			}
		}

		expectedHasNext := outstanding > 0
		if *envelope.HasNext != expectedHasNext {
			idWord := "ids"
			if outstanding == 1 {
				idWord = "id"
			}
			return nil, fmt.Errorf("defer advisor multipart part %d hasNext %t with %d pending %s outstanding", partNumber, *envelope.HasNext, outstanding, idWord)
		}
		if !*envelope.HasNext {
			terminalSeen = true
			run.terminalAt = dataTimes[i]
		}
	}
	if !terminalSeen {
		return nil, fmt.Errorf("defer advisor stream has no hasNext false terminal part")
	}
	return run, nil
}

func advisorGraphQLDataValid(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return bytes.Equal(trimmed, []byte("null")) || len(trimmed) != 0 && trimmed[0] == '{'
}

func advisorPendingPath(raw json.RawMessage) (string, error) {
	if raw == nil {
		return "", fmt.Errorf("has no path")
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return "", fmt.Errorf("path must be an array")
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var path []any
	if err := decoder.Decode(&path); err != nil || path == nil {
		return "", fmt.Errorf("path must be an array")
	}
	for i, element := range path {
		switch element := element.(type) {
		case string:
		case json.Number:
			index, err := strconv.ParseInt(element.String(), 10, 64)
			if err != nil || index < 0 {
				return "", fmt.Errorf("path element %d must be a string or non-negative integer", i+1)
			}
		default:
			return "", fmt.Errorf("path element %d must be a string or non-negative integer", i+1)
		}
	}
	canonical, err := json.Marshal(path)
	if err != nil {
		return "", fmt.Errorf("path cannot be encoded: %w", err)
	}
	return string(canonical), nil
}

func advisorRawErrorsPresent(raw json.RawMessage) (bool, error) {
	if raw == nil {
		return false, nil
	}
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		return false, fmt.Errorf("errors must be a non-empty array when present")
	}
	var errorsList []json.RawMessage
	if err := json.Unmarshal(trimmed, &errorsList); err != nil {
		return false, err
	}
	if len(errorsList) == 0 {
		return false, fmt.Errorf("errors must be a non-empty array when present")
	}
	for i, item := range errorsList {
		item = bytes.TrimSpace(item)
		if len(item) == 0 || item[0] != '{' {
			return false, fmt.Errorf("errors item %d must be an object", i+1)
		}
	}
	return true, nil
}
