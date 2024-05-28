package integration

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/andybalholm/brotli"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

const employeesIdData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

func decompressGzip(t *testing.T, body io.Reader) []byte {
	gr, err := gzip.NewReader(body)
	require.NoError(t, err)
	defer gr.Close()
	data, err := io.ReadAll(gr)
	require.NoError(t, err)
	return data
}

func decompressDeflate(t *testing.T, body io.Reader) []byte {
	dr := flate.NewReader(body)
	defer dr.Close()
	data, err := io.ReadAll(dr)
	require.NoError(t, err)
	return data
}

func decompressBrotli(t *testing.T, body io.Reader) []byte {
	br := brotli.NewReader(body)
	data, err := io.ReadAll(br)
	require.NoError(t, err)
	return data
}

func decompressNone(t *testing.T, body io.Reader) []byte {
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	return data
}

func TestResponseCompression(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name           string
		encoding       string
		decompressFunc func(t *testing.T, body io.Reader) []byte
		expectEncoding bool
	}{
		{"gzip", "gzip", decompressGzip, true},
		{"deflate", "deflate", decompressDeflate, true},
		{"brotli", "br", decompressBrotli, true},
		{"identity", "identity", decompressNone, false}, // NO Encoding
		{"zstd", "zstd", decompressNone, false},         // Unsuported Encoding
	}

	for _, tc := range testCases {
		tc := tc // capture range variable
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel() // mark the subtest as parallel
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				headers := http.Header{
					"Content-Type": []string{"application/json"},
				}
				if tc.encoding != "" {
					headers.Set("Accept-Encoding", tc.encoding)
				}

				query := `query { employees { id } }`
				data := map[string]interface{}{
					"query": query,
				}
				body, err := json.Marshal(data)
				require.NoError(t, err)

				res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", headers, bytes.NewReader(body))
				require.NoError(t, err)
				defer res.Body.Close()

				if tc.expectEncoding {
					require.Equal(t, tc.encoding, res.Header.Get("Content-Encoding"))
				} else {
					require.Empty(t, res.Header.Get("Content-Encoding"))
				}
				require.Contains(t, res.Header.Get("Content-Type"), "application/json")

				decompressedBody := tc.decompressFunc(t, res.Body)
				require.JSONEq(t, employeesIdData, string(decompressedBody))
			})
		})
	}
}
