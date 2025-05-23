package core

import (
	"bytes"
	"github.com/stretchr/testify/require"
	"io"
	"strings"
	"testing"
	"time"
)

func TestBatch(t *testing.T) {
	t.Run("verify performance gains for huge strings", func(t *testing.T) {
		t.Parallel()

		rs := randomString(defaultBufioReaderSize*50, 'A')
		fullString := `{"somestring": ` + rs + `}`

		readerForFunc := bytes.NewBufferString(fullString)
		funcStart := time.Now()
		_, _, err := getFirstNonWhitespaceChar(readerForFunc, defaultBufioReaderSize)
		funcElapsed := time.Since(funcStart)
		require.NoError(t, err)

		readAllReader := bytes.NewBufferString(fullString)
		readAllStart := time.Now()
		_, err = io.ReadAll(readAllReader)
		readAllElapsed := time.Since(readAllStart)
		require.NoError(t, err)

		require.Greater(t, readAllElapsed, funcElapsed)
	})

	t.Run("verify string is read even when buffer is smaller without spaces", func(t *testing.T) {
		t.Parallel()

		rs := randomString(2000, 'A')
		fullString := `{"somestring": ` + rs + `}`

		readerForFunc := bytes.NewBufferString(fullString)
		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 256)
		require.NoError(t, err)
		require.Equal(t, fullString[0], *firstChar)

		all, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, fullString, string(all))
	})

	t.Run("verify string is read even when buffer is larger without spaces", func(t *testing.T) {
		t.Parallel()

		rs := randomString(2000, 'A')
		fullString := `{"somestring": ` + rs + `}`

		readerForFunc := bytes.NewBufferString(fullString)
		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 25600)
		require.NoError(t, err)
		require.Equal(t, fullString[0], *firstChar)

		all, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, fullString, string(all))
	})

	t.Run("verify string when string has spaces with smaller buffer size", func(t *testing.T) {
		t.Parallel()

		rs := randomString(2000, 'A')
		primaryString := `[{"somestring": ` + rs + `}]`
		fullString := "  \n\r    \t  " + primaryString

		readerForFunc := bytes.NewBufferString(fullString)
		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 16)
		require.NoError(t, err)
		require.Equal(t, primaryString[0], *firstChar)

		readString, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, primaryString, string(readString))
	})

	t.Run("verify string when string has spaces with larger buffer size", func(t *testing.T) {
		t.Parallel()

		rs := randomString(2000, 'A')
		primaryString := `[{"somestring": ` + rs + `}]`
		fullString := "  \n\r    \t  " + primaryString

		readerForFunc := bytes.NewBufferString(fullString)
		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 160000)
		require.NoError(t, err)
		require.Equal(t, primaryString[0], *firstChar)

		readString, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, primaryString, string(readString))
	})

	t.Run("verify string when spaces are larger than buffer size", func(t *testing.T) {
		t.Parallel()

		rs := randomString(2000, 'A')
		primaryString := `[{"somestring": ` + rs + `}]`
		whitespaceString := randomString(200, ' ')
		fullString := "  \n\r    \t  " + whitespaceString + " \t \r " + primaryString

		readerForFunc := bytes.NewBufferString(fullString)

		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 32)
		require.NoError(t, err)
		require.Equal(t, primaryString[0], *firstChar)

		readString, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, primaryString, string(readString))
	})

	t.Run("verify string when string is only spaces when buffer is smaller", func(t *testing.T) {
		t.Parallel()

		whitespaceString := randomString(200, ' ')
		fullString := "  \n\r    \t  " + whitespaceString + " \t \r "

		readerForFunc := bytes.NewBufferString(fullString)

		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 32)
		require.NoError(t, err)
		require.Nil(t, firstChar)

		readString, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, "", string(readString))
	})

	t.Run("verify string when string is only spaces when buffer is larger", func(t *testing.T) {
		t.Parallel()

		whitespaceString := randomString(200, ' ')
		fullString := "  \n\r    \t  " + whitespaceString + " \t \r "

		readerForFunc := bytes.NewBufferString(fullString)

		firstChar, bufferReader, err := getFirstNonWhitespaceChar(readerForFunc, 3200)
		require.NoError(t, err)
		require.Nil(t, firstChar)

		readString, err := io.ReadAll(bufferReader)
		require.NoError(t, err)
		require.Equal(t, "", string(readString))
	})

}

func randomString(n int, generateRune rune) string {
	var sb strings.Builder

	for i := 0; i < n; i++ {
		sb.WriteRune(generateRune)
	}

	s := sb.String()
	return s
}
