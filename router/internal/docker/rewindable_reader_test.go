package docker

import (
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRewindableReader(t *testing.T) {
	t.Parallel()
	const data = "hello world"
	t.Run("read until end, then rewind", func(t *testing.T) {
		t.Parallel()
		r := newRewindableReader(strings.NewReader(data))
		data1, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Equal(t, data, string(data1))

		empty, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Len(t, empty, 0)

		r.Rewind()

		data2, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Equal(t, data, string(data2))
	})

	t.Run("rewind before reading", func(t *testing.T) {
		t.Parallel()

		r := newRewindableReader(strings.NewReader(data))
		r.Rewind()
		data1, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Equal(t, data, string(data1))
	})

	t.Run("close and rewind before reading", func(t *testing.T) {
		t.Parallel()

		r := newRewindableReader(strings.NewReader(data))
		assert.NoError(t, r.Close())
		r.Rewind()
		data1, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Equal(t, data, string(data1))
	})

	t.Run("partial read before close", func(t *testing.T) {
		t.Parallel()

		r := newRewindableReader(strings.NewReader(data))
		buf := make([]byte, 5)
		_, err := io.ReadFull(r, buf)
		assert.NoError(t, err)
		assert.Equal(t, "hello", string(buf))
		assert.NoError(t, r.Close())
		r.Rewind()
		data1, err := io.ReadAll(r)
		assert.NoError(t, err)
		assert.Equal(t, data, string(data1))
	})
}
