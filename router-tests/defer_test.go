package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/buger/jsonparser"
	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDeferTestdataQueries(t *testing.T) {
	t.Parallel()

	testDir := filepath.Join("testdata", "queries_defer")
	entries, err := os.ReadDir(testDir)
	require.NoError(t, err)

	for _, entry := range entries {
		fileName := entry.Name()
		ext := filepath.Ext(fileName)
		name := strings.TrimSuffix(fileName, ext)

		if ext != ".graphql" {
			continue
		}

		// "full_defer_01_single_defer" → source = "full"
		source, _, found := strings.Cut(name, "_defer_")
		if !found {
			continue
		}

		t.Run(name, func(t *testing.T) {
			t.Parallel()

			gMultipart := goldie.New(
				t,
				goldie.WithFixtureDir("testdata/queries_defer"),
				goldie.WithNameSuffix(".txt"),
				goldie.WithDiffEngine(goldie.ClassicDiff),
			)
			gFull := goldie.New(
				t,
				goldie.WithFixtureDir("testdata/queries_defer"),
				goldie.WithNameSuffix(".json"),
				goldie.WithDiffEngine(goldie.ClassicDiff),
			)

			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.Debug.PrintIntermediateQueryPlans = true
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				queryData, err := os.ReadFile(filepath.Join(testDir, fmt.Sprintf("%s.graphql", name)))
				require.NoError(t, err)

				payload := map[string]any{"query": string(queryData)}
				payloadData, err := json.Marshal(payload)
				require.NoError(t, err)

				req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payloadData))
				res, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer func() { require.NoError(t, res.Body.Close()) }()

				require.Equal(t, http.StatusOK, res.StatusCode)
				require.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "multipart/mixed"),
					"expected multipart/mixed response, got: %s", res.Header.Get("Content-Type"))

				body, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				t.Run("multipart body", func(t *testing.T) {
					// Assert raw multipart body.
					gMultipart.Assert(t, name, body)
				})

				t.Run("full response", func(t *testing.T) {
					// Reconstruct full response from chunks and assert against original.
					reconstructed, err := reconstructDeferResponse(body)
					require.NoError(t, err)

					actual := normalizeJSON(t, reconstructed)

					gFull.Assert(t, name+"_reconstructed", actual)

					// compare with original
					if false {
						expected, err := os.ReadFile(gFull.GoldenFileName(t, source+"_original"))
						require.NoError(t, err)
						// manually assert to never update original when update flag is specified
						if diff := goldie.Diff(goldie.ClassicDiff, string(actual), string(expected)); diff != "" {
							t.Fatal(diff)
						}
					}
				})
			})
		})
	}
}

// reconstructDeferResponse parses a multipart/mixed defer body, merges all
// incremental patches onto the initial data using jsonparser, and returns
// the complete JSON response (without transport fields like hasNext).
func reconstructDeferResponse(body []byte) ([]byte, error) {
	parts, err := parseMultipartParts(body)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("no parts in multipart response")
	}

	result := parts[0]

	for _, part := range parts[1:] {
		var innerErr error
		_, err = jsonparser.ArrayEach(part, func(item []byte, _ jsonparser.ValueType, _ int, _ error) {
			if innerErr != nil {
				return
			}

			patchData, dataType, _, e := jsonparser.Get(item, "data")
			if e != nil || dataType == jsonparser.NotExist {
				return
			}

			// Build path keys: prepend "data", convert array indices to "[N]".
			pathKeys := []string{"data"}
			_, e = jsonparser.ArrayEach(item, func(seg []byte, segType jsonparser.ValueType, _ int, _ error) {
				if segType == jsonparser.Number {
					pathKeys = append(pathKeys, "["+string(seg)+"]")
				} else {
					pathKeys = append(pathKeys, string(seg))
				}
			}, "path")
			if e != nil {
				innerErr = fmt.Errorf("parse path: %w", e)
				return
			}

			result, innerErr = mergeJSONAtPath(result, patchData, pathKeys)
			if innerErr != nil {
				return
			}

			// Collect errors from incremental items into root errors.
			patchErrors, errType, _, _ := jsonparser.Get(item, "errors")
			if errType == jsonparser.Array {
				existing, existingType, _, _ := jsonparser.Get(result, "errors")
				if existingType == jsonparser.NotExist || existingType == jsonparser.Null {
					result, innerErr = jsonparser.Set(result, patchErrors, "errors")
				} else {
					merged := appendJSONArrays(existing, patchErrors)
					result, innerErr = jsonparser.Set(result, merged, "errors")
				}
			}
		}, "incremental")
		if err != nil {
			return nil, fmt.Errorf("parse incremental: %w", err)
		}
		if innerErr != nil {
			return nil, innerErr
		}
	}

	// Remove transport-only field.
	result = jsonparser.Delete(result, "hasNext")

	return result, nil
}

// mergeJSONAtPath navigates to pathKeys inside result and deep-merges patch there.
func mergeJSONAtPath(result, patch []byte, pathKeys []string) ([]byte, error) {
	if len(pathKeys) == 0 {
		return deepMergeJSON(result, patch)
	}
	existing, existingType, _, err := jsonparser.Get(result, pathKeys...)
	if err != nil || existingType == jsonparser.NotExist {
		return jsonparser.Set(result, patch, pathKeys...)
	}
	if existingType != jsonparser.Object {
		return jsonparser.Set(result, patch, pathKeys...)
	}
	merged, err := deepMergeJSON(existing, patch)
	if err != nil {
		return nil, err
	}
	return jsonparser.Set(result, merged, pathKeys...)
}

// deepMergeJSON merges src object into dst object recursively.
// For object values present in both, it recurses; otherwise src wins.
func deepMergeJSON(dst, src []byte) ([]byte, error) {
	result := dst
	var innerErr error
	err := jsonparser.ObjectEach(src, func(key, value []byte, dataType jsonparser.ValueType, _ int) error {
		if innerErr != nil {
			return nil
		}
		k := string(key)
		if dataType == jsonparser.Object {
			existingVal, existingType, _, _ := jsonparser.Get(result, k)
			if existingType == jsonparser.Object {
				merged, e := deepMergeJSON(existingVal, value)
				if e != nil {
					innerErr = e
					return nil
				}
				result, innerErr = jsonparser.Set(result, merged, k)
				return nil
			}
		}
		result, innerErr = jsonparser.Set(result, value, k)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, innerErr
}

// appendJSONArrays concatenates two JSON arrays: [...a, ...b].
func appendJSONArrays(a, b []byte) []byte {
	aInner := bytes.TrimSpace(a[1 : len(a)-1])
	bInner := bytes.TrimSpace(b[1 : len(b)-1])
	if len(aInner) == 0 {
		return b
	}
	if len(bInner) == 0 {
		return a
	}
	out := make([]byte, 0, 1+len(aInner)+1+len(bInner)+1)
	out = append(out, '[')
	out = append(out, aInner...)
	out = append(out, ',')
	out = append(out, bInner...)
	out = append(out, ']')
	return out
}

// parseMultipartParts splits a multipart/mixed body on the --graphql boundary
// and returns the raw JSON bytes of each part.
func parseMultipartParts(body []byte) ([][]byte, error) {
	boundary := []byte("\r\n--graphql")
	parts := bytes.Split(body, boundary)
	var result [][]byte
	for _, part := range parts {
		if bytes.HasPrefix(part, []byte("--")) {
			continue
		}
		_, jsonBody, found := bytes.Cut(part, []byte("\r\n\r\n"))
		if !found {
			continue
		}
		jsonBody = bytes.TrimSpace(jsonBody)
		if len(jsonBody) == 0 {
			continue
		}
		result = append(result, jsonBody)
	}
	return result, nil
}
