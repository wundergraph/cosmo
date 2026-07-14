package core

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const (
	deferAdvisorMaxLoopbackResponseBytes = 16 << 20
	// One segment per JSON part plus the writer's close-only segment.
	deferAdvisorMaxLoopbackSegments = 4_097
)

var (
	errLoopbackResponseTooLarge = errors.New("defer advisor loopback response exceeds the byte limit")
	errLoopbackTooManySegments  = errors.New("defer advisor loopback response exceeds the segment limit")
)

type loopbackRecorderLimits struct {
	maxBytes    int64
	maxSegments int
}

// loopbackRecorder is the http.ResponseWriter handed to loopback sub-requests.
// Each Flush closes a segment with a timestamp; for @defer responses the
// multipart writer flushes once per JSON part and once for the close-only
// suffix, so every data segment maps 1:1 to a part.
type loopbackRecorder struct {
	header      http.Header
	status      int
	wroteHeader bool
	start       time.Time
	buf         bytes.Buffer
	segments    []loopbackSegment
	written     int64
	limits      loopbackRecorderLimits
	err         error
	cancel      func()
}

type loopbackSegment struct {
	body []byte
	at   time.Duration
}

func newLoopbackRecorder(start time.Time) *loopbackRecorder {
	return newLoopbackRecorderWithLimits(start, loopbackRecorderLimits{
		maxBytes:    deferAdvisorMaxLoopbackResponseBytes,
		maxSegments: deferAdvisorMaxLoopbackSegments,
	})
}

func newLoopbackRecorderWithLimits(start time.Time, limits loopbackRecorderLimits) *loopbackRecorder {
	return newLoopbackRecorderWithLimitsAndCancel(start, limits, nil)
}

func newLoopbackRecorderWithLimitsAndCancel(start time.Time, limits loopbackRecorderLimits, cancel func()) *loopbackRecorder {
	return &loopbackRecorder{
		header: make(http.Header),
		status: http.StatusOK,
		start:  start,
		limits: limits,
		cancel: cancel,
	}
}

func (l *loopbackRecorder) Header() http.Header { return l.header }

func (l *loopbackRecorder) WriteHeader(status int) {
	if l.wroteHeader {
		return
	}
	l.status = status
	l.wroteHeader = true
}

func (l *loopbackRecorder) Write(p []byte) (int, error) {
	if !l.wroteHeader {
		l.WriteHeader(http.StatusOK)
	}
	if l.err != nil {
		return 0, l.err
	}
	if int64(len(p)) > l.limits.maxBytes-l.written {
		l.fail(fmt.Errorf("%w (%d bytes)", errLoopbackResponseTooLarge, l.limits.maxBytes))
		return 0, l.err
	}
	l.written += int64(len(p))
	return l.buf.Write(p)
}

func (l *loopbackRecorder) Flush() {
	if !l.wroteHeader {
		l.WriteHeader(http.StatusOK)
	}
	if l.err != nil || l.buf.Len() == 0 {
		return
	}
	if len(l.segments) >= l.limits.maxSegments {
		l.fail(fmt.Errorf("%w (%d segments)", errLoopbackTooManySegments, l.limits.maxSegments))
		return
	}
	// Transfer ownership of the backing array into the immutable segment. A
	// fresh buffer avoids retaining and cloning the largest flushed part.
	body := l.buf.Bytes()
	l.buf = bytes.Buffer{}
	l.segments = append(l.segments, loopbackSegment{body: body, at: time.Since(l.start)})
}

func (l *loopbackRecorder) fail(err error) {
	if l.err != nil {
		return
	}
	l.err = err
	if l.cancel != nil {
		l.cancel()
	}
}

// fullBody returns everything written, joining segments for flushed responses.
func (l *loopbackRecorder) fullBody() []byte {
	if len(l.segments) == 0 {
		return bytes.Clone(l.buf.Bytes())
	}
	var out bytes.Buffer
	for _, segment := range l.segments {
		out.Write(segment.body)
	}
	out.Write(l.buf.Bytes())
	return out.Bytes()
}

// extractDeferPartJSON strips the multipart part headers and the eagerly
// written next boundary from a flushed segment and returns the raw JSON
// payload. The close-only segment returns terminal=true with no payload.
func extractDeferPartJSON(segment []byte) (jsonPayload []byte, terminal bool, err error) {
	if bytes.Equal(segment, []byte(deferClose)) {
		return nil, true, nil
	}

	var header string
	switch {
	case bytes.HasPrefix(segment, []byte(deferFirstPartHeader)):
		header = deferFirstPartHeader
	case bytes.HasPrefix(segment, []byte(deferNextPartHeader)):
		header = deferNextPartHeader
	default:
		return nil, false, fmt.Errorf("defer loopback segment has invalid part headers")
	}
	framedPayload, found := bytes.CutSuffix(segment, []byte(deferPartSuffix))
	if !found {
		return nil, false, fmt.Errorf("defer loopback data segment is missing its eager boundary")
	}
	payload := bytes.TrimSpace(framedPayload[len(header):])
	if len(payload) == 0 || payload[0] != '{' {
		return nil, false, fmt.Errorf("defer loopback part payload is not a JSON object")
	}
	return payload, false, nil
}

var _ http.Flusher = (*loopbackRecorder)(nil)
