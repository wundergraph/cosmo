package integration

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/buger/jsonparser"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
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

	employeesIdDataMinSizeGzip := `{"data":{"employees":[{"id":1}` + strings.Repeat(`,{"id":1}`, 460) + `]}}` // > 4kb

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

func TestResponseCompressionWithCustomMinSize(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name         string
		minSize      config.BytesString
		encoding     string
		responseData string
	}{
		{"compression enabled when response is greater than custom min size", config.BytesString(len(employeesIdData) - 1), "gzip", employeesIdData},
		{"compression enabled when response is equal to custom min size", config.BytesString(len(employeesIdData)), "gzip", employeesIdData},
		{"compression disabled when response is less than custom min size", config.BytesString(len(employeesIdData) + 1), "", employeesIdData},
	}

	for _, tc := range testCases {
		tc := tc // capture range variable
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel() // mark the subtest as parallel
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						ResponseCompressionMinSize: tc.minSize,
						MaxRequestBodyBytes:        5 << 20, // 5MB
					}),
				},
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
					"Content-Type":    []string{"application/json"},
					"Accept-Encoding": []string{"gzip"},
				}

				data := map[string]interface{}{
					"query": `query { employees { id } }`,
				}
				body, err := json.Marshal(data)
				require.NoError(t, err)

				res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", headers, bytes.NewReader(body))
				require.NoError(t, err)
				defer res.Body.Close()

				if tc.encoding != "" {
					require.Equal(t, tc.encoding, res.Header.Get("Content-Encoding"))
				} else {
					require.Empty(t, res.Header.Get("Content-Encoding"))
				}

				// Read and decompress the response
				responseBody, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				var decompressedBody []byte
				if tc.encoding != "" {
					decompressedBody = decompressGzip(t, bytes.NewReader(responseBody))
				} else {
					decompressedBody = responseBody
				}

				require.Contains(t, res.Header.Get("Content-Type"), "application/json")
				require.JSONEq(t, tc.responseData, string(decompressedBody))
			})
		})
	}
}
