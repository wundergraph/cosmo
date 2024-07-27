package integration

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"github.com/buger/jsonparser"
	"io"
	"net/http"
	"strings"
	"testing"

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

func decompressNone(t *testing.T, body io.Reader) []byte {
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	return data
}

func TestResponseCompression(t *testing.T) {
	t.Parallel()

	employeesIdDataMinSizeGzip := `{"data":{"employees":[{"id":1}` + strings.Repeat(`,{"id":1}`, 200) + `]}}`

	testCases := []struct {
		name           string
		encoding       string
		decompressFunc func(t *testing.T, body io.Reader) []byte
		expectEncoding bool
		responseData   string
	}{
		{"gzip with min size", "gzip", decompressGzip, true, employeesIdDataMinSizeGzip},     // Gzip Encoding with min size
		{"no gzip because request is too small", "", decompressGzip, false, employeesIdData}, // No Gzip Encoding because of min size
		{"identity", "identity", decompressNone, false, employeesIdData},                     // NO Encoding
		{"zstd", "zstd", decompressNone, false, employeesIdData},                             // Unsuported Encoding
	}

	for _, tc := range testCases {
		tc := tc // capture range variable
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel() // mark the subtest as parallel
			testenv.Run(t, &testenv.Config{
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								data, err := io.ReadAll(r.Body)
								require.NoError(t, err)
								_, dt, _, _ := jsonparser.Get(data, "extensions", "persistedQuery")
								require.Equal(t, jsonparser.NotExist, dt)
								_, _ = w.Write([]byte(tc.responseData))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
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
					decompressedBody := tc.decompressFunc(t, res.Body)
					require.JSONEq(t, tc.responseData, string(decompressedBody))
				} else {
					require.Empty(t, res.Header.Get("Content-Encoding"))
				}
				require.Contains(t, res.Header.Get("Content-Type"), "application/json")
			})
		})
	}
}
