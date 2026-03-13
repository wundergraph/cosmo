package events_test

import (
	"bufio"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

const EventWaitTimeout = time.Second * 30

func assertLineEquals(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	line := testenv.ReadSSELine(t, reader)
	assert.Equal(t, expected, line)
}

func assertMultipartPrefix(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	assertLineEquals(t, reader, "")
	assertLineEquals(t, reader, "--graphql")
	assertLineEquals(t, reader, "Content-Type: application/json")
	assertLineEquals(t, reader, "")
}

func assertMultipartValueEventually(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	assert.Eventually(t, func() bool {
		assertMultipartPrefix(t, reader)
		line, _, err := reader.ReadLine()
		assert.NoError(t, err)
		if string(line) == "{}" {
			return false
		}
		assert.Equal(t, expected, string(line))
		return true
	}, EventWaitTimeout, time.Millisecond*100)
}
