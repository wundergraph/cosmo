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

func TestCompression(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name           string
		encoding       string
		decompressFunc func(t *testing.T, body io.Reader) []byte
	}{
		{"gzip", "gzip", decompressGzip},
		{"deflate", "deflate", decompressDeflate},
		{"brotli", "br", decompressBrotli},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				headers := http.Header{
					"Accept-Encoding": []string{tc.encoding},
					"Content-Type":    []string{"application/json"},
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

				require.Equal(t, tc.encoding, res.Header.Get("Content-Encoding"))
				require.Contains(t, res.Header.Get("Content-Type"), "application/json")

				decompressedBody := tc.decompressFunc(t, res.Body)
				require.JSONEq(t, employeesIDData, string(decompressedBody))
			})
		})
	}
}
