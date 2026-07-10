package core

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestLoopbackRecorder() *loopbackRecorder {
	return newLoopbackRecorder(time.Unix(1, 0))
}

func TestLoopbackRecorderUsesHTTPResponseWriterSemantics(t *testing.T) {
	t.Parallel()

	t.Run("header map is retained", func(t *testing.T) {
		t.Parallel()

		recorder := newTestLoopbackRecorder()
		recorder.Header().Set("X-Test", "value")

		assert.Equal(t, "value", recorder.Header().Get("X-Test"))
	})

	t.Run("first status wins", func(t *testing.T) {
		t.Parallel()

		recorder := newTestLoopbackRecorder()
		recorder.WriteHeader(http.StatusCreated)
		recorder.WriteHeader(http.StatusInternalServerError)
		_, err := recorder.Write([]byte("created"))
		require.NoError(t, err)

		assert.Equal(t, http.StatusCreated, recorder.status)
		assert.Equal(t, []byte("created"), recorder.fullBody())
	})

	t.Run("write implies success", func(t *testing.T) {
		t.Parallel()

		recorder := newTestLoopbackRecorder()
		_, err := recorder.Write([]byte("ok"))
		require.NoError(t, err)

		assert.Equal(t, http.StatusOK, recorder.status)
		assert.Equal(t, []byte("ok"), recorder.fullBody())
	})

	t.Run("flush implies success without inventing a segment", func(t *testing.T) {
		t.Parallel()

		recorder := newTestLoopbackRecorder()
		recorder.Flush()

		assert.Equal(t, http.StatusOK, recorder.status)
		assert.Empty(t, recorder.segments)
	})
}

func TestLoopbackRecorderPreservesFlushedSegmentsAndFullBody(t *testing.T) {
	t.Parallel()

	recorder := newTestLoopbackRecorder()
	_, err := recorder.Write([]byte("first"))
	require.NoError(t, err)
	recorder.Flush()
	_, err = recorder.Write([]byte("second"))
	require.NoError(t, err)
	recorder.Flush()
	_, err = recorder.Write([]byte("tail"))
	require.NoError(t, err)

	require.Len(t, recorder.segments, 2)
	assert.Equal(t, []byte("first"), recorder.segments[0].body)
	assert.Equal(t, []byte("second"), recorder.segments[1].body)
	assert.Equal(t, []byte("firstsecondtail"), recorder.fullBody())
}

func TestExtractDeferPartJSON(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		segment  string
		body     string
		terminal bool
		err      string
	}{
		{
			name:    "first part with eager next boundary",
			segment: deferFirstPartHeader + "{\"data\":{\"fast\":true},\"hasNext\":true}" + deferPartSuffix,
			body:    "{\"data\":{\"fast\":true},\"hasNext\":true}",
		},
		{
			name:    "subsequent part whose boundary was already flushed",
			segment: deferNextPartHeader + "{\"completed\":[{\"id\":\"1\"}],\"hasNext\":false}" + deferPartSuffix,
			body:    "{\"completed\":[{\"id\":\"1\"}],\"hasNext\":false}",
		},
		{name: "closing suffix", segment: deferClose, terminal: true},
		{name: "missing part headers", segment: "{\"data\":null}", err: "defer loopback segment has invalid part headers"},
		{name: "truncated eager boundary", segment: deferNextPartHeader + "{\"data\":null}", err: "defer loopback data segment is missing its eager boundary"},
		{name: "non-object payload", segment: deferNextPartHeader + "[]" + deferPartSuffix, err: "defer loopback part payload is not a JSON object"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			body, terminal, err := extractDeferPartJSON([]byte(test.segment))

			assert.Equal(t, test.body, string(body))
			assert.Equal(t, test.terminal, terminal)
			if test.err == "" {
				require.NoError(t, err)
			} else {
				require.EqualError(t, err, test.err)
			}
		})
	}
}

func TestLoopbackRecorderAndDeferWriterUseTheSameExactSegments(t *testing.T) {
	t.Parallel()

	recorder := newTestLoopbackRecorder()
	writer := &HttpDeferWriter{
		ctx:     context.Background(),
		writer:  recorder,
		flusher: recorder,
		buf:     &bytes.Buffer{},
	}
	parts := []string{
		`{"data":{"fast":true},"hasNext":true}`,
		`{"completed":[{"id":"1"}],"hasNext":false}`,
	}
	for _, part := range parts {
		_, err := writer.Write([]byte(part))
		require.NoError(t, err)
		require.NoError(t, writer.Flush())
	}
	writer.Complete()

	require.Len(t, recorder.segments, 3)
	assert.Equal(t, []byte(deferFirstPartHeader+parts[0]+deferPartSuffix), recorder.segments[0].body)
	assert.Equal(t, []byte(deferNextPartHeader+parts[1]+deferPartSuffix), recorder.segments[1].body)
	assert.Equal(t, []byte(deferClose), recorder.segments[2].body)
	for i, expected := range parts {
		body, terminal, err := extractDeferPartJSON(recorder.segments[i].body)
		require.NoError(t, err)
		assert.False(t, terminal)
		assert.Equal(t, expected, string(body))
	}
	body, terminal, err := extractDeferPartJSON(recorder.segments[2].body)
	require.NoError(t, err)
	assert.Nil(t, body)
	assert.True(t, terminal)
}

func TestLoopbackRecorderSegmentBudgetIncludesTheClosingSegment(t *testing.T) {
	t.Parallel()

	recorder := newLoopbackRecorderWithLimits(time.Unix(1, 0), loopbackRecorderLimits{maxBytes: 1_024, maxSegments: 2})
	writer := &HttpDeferWriter{
		ctx:     context.Background(),
		writer:  recorder,
		flusher: recorder,
		buf:     &bytes.Buffer{},
	}
	_, err := writer.Write([]byte(`{"data":null,"hasNext":false}`))
	require.NoError(t, err)
	require.NoError(t, writer.Flush())
	writer.Complete()

	require.NoError(t, recorder.err)
	require.Len(t, recorder.segments, 2)
	assert.Equal(t, []byte(deferClose), recorder.segments[1].body)
}

func TestLoopbackRecorderEnforcesResponseBudgets(t *testing.T) {
	t.Parallel()

	t.Run("bytes", func(t *testing.T) {
		t.Parallel()

		recorder := newLoopbackRecorderWithLimits(time.Unix(1, 0), loopbackRecorderLimits{maxBytes: 5, maxSegments: 2})
		written, err := recorder.Write([]byte("12345"))
		require.NoError(t, err)
		assert.Equal(t, 5, written)

		written, err = recorder.Write([]byte("6"))
		assert.Zero(t, written)
		assert.True(t, errors.Is(err, errLoopbackResponseTooLarge))
		assert.True(t, errors.Is(recorder.err, errLoopbackResponseTooLarge))
		assert.Equal(t, []byte("12345"), recorder.fullBody())
	})

	t.Run("segments", func(t *testing.T) {
		t.Parallel()

		recorder := newLoopbackRecorderWithLimits(time.Unix(1, 0), loopbackRecorderLimits{maxBytes: 20, maxSegments: 1})
		_, err := recorder.Write([]byte("first"))
		require.NoError(t, err)
		recorder.Flush()
		_, err = recorder.Write([]byte("second"))
		require.NoError(t, err)
		recorder.Flush()

		assert.True(t, errors.Is(recorder.err, errLoopbackTooManySegments))
		require.Len(t, recorder.segments, 1)
		assert.Equal(t, []byte("firstsecond"), recorder.fullBody())
		written, err := recorder.Write([]byte("ignored"))
		assert.Zero(t, written)
		assert.True(t, errors.Is(err, errLoopbackTooManySegments))
	})
}
