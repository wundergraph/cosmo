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

	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDeferTestDataQueries(t *testing.T) {
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
				NoRetryClient: true,
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.Debug.PrintIntermediateQueryPlans = true
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				queryFilePath := filepath.Join(testDir, fmt.Sprintf("%s.graphql", name))
				t.Cleanup(func() {
					if t.Failed() {
						abs, _ := filepath.Abs(queryFilePath)
						t.Logf("query file: %s", abs)
					}
				})

				queryData, err := os.ReadFile(queryFilePath)
				require.NoError(t, err)

				payload := map[string]any{"query": string(queryData)}
				payloadData, err := json.Marshal(payload)
				require.NoError(t, err)

				req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payloadData))
				res, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer func() { require.NoError(t, res.Body.Close()) }()

				assert.Equal(t, http.StatusOK, res.StatusCode)

				// defer could be fully discarded in case query has duplicate field which are not deffered
				isMultipart := strings.HasPrefix(res.Header.Get("Content-Type"), "multipart/mixed")

				body, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				t.Run("raw multipart body", func(t *testing.T) {
					gMultipart.Assert(t, name, body)
				})

				t.Run("full response", func(t *testing.T) {
					var actual []byte

					if isMultipart {
						// Reconstruct the full response from chunks
						reconstructed, err := reconstructDeferResponse(body)
						require.NoError(t, err)
						actual = normalizeJSON(t, reconstructed)
					} else {
						actual = normalizeJSON(t, body)
					}

					gFull.Assert(t, name+"_reconstructed", actual)

					// compare with original
					if false {
						expected, err := os.ReadFile(gFull.GoldenFileName(t, source+"_original"))
						require.NoError(t, err)
						// manually assert to never update the original when the update flag is specified
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
// incremental patches onto the initial data using astjson, and returns
// the complete JSON response (without transport fields like hasNext).
func reconstructDeferResponse(body []byte) ([]byte, error) {
	parts, err := parseMultipartParts(body)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("no parts in multipart response")
	}

	var p astjson.Parser
	result, err := p.ParseBytes(parts[0])
	if err != nil {
		return nil, fmt.Errorf("parse initial part: %w", err)
	}

	for _, part := range parts[1:] {
		partVal, err := p.ParseBytes(part)
		if err != nil {
			return nil, fmt.Errorf("parse part: %w", err)
		}

		for _, item := range partVal.GetArray("incremental") {
			patchData := item.Get("data")
			if patchData == nil {
				continue
			}

			// Build path: prepend "data", then each segment from the path array.
			pathKeys := []string{"data"}
			for _, seg := range item.GetArray("path") {
				switch seg.Type() {
				case astjson.TypeNumber:
					pathKeys = append(pathKeys, string(seg.MarshalTo(nil)))
				default:
					s, _ := seg.StringBytes()
					pathKeys = append(pathKeys, string(s))
				}
			}

			if err := mergeAtPath(result, patchData, pathKeys); err != nil {
				return nil, fmt.Errorf("merge at path %v: %w", pathKeys, err)
			}

			// Collect errors from incremental items into root errors.
			patchErrors := item.Get("errors")
			if patchErrors != nil && patchErrors.Type() == astjson.TypeArray {
				existing := result.Get("errors")
				if existing == nil || existing.Type() == astjson.TypeNull {
					result.Set(nil, "errors", patchErrors)
				} else {
					merged := appendArrayValues(existing, patchErrors)
					result.Set(nil, "errors", merged)
				}
			}
		}
	}

	// Remove transport-only field.
	result.Del("hasNext")

	return result.MarshalTo(nil), nil
}

// mergeAtPath navigates result to the node at pathKeys and deep-merges patch there.
func mergeAtPath(result, patch *astjson.Value, pathKeys []string) error {
	if len(pathKeys) == 0 {
		_, _, err := astjson.MergeValues(nil, result, patch)
		return err
	}

	// Navigate to the parent of the target node.
	current := result
	for _, key := range pathKeys[:len(pathKeys)-1] {
		next := current.Get(key)
		if next == nil {
			return nil
		}
		current = next
	}

	lastKey := pathKeys[len(pathKeys)-1]
	target := current.Get(lastKey)
	if target == nil {
		current.Set(nil, lastKey, patch)
		return nil
	}

	merged, _, err := astjson.MergeValues(nil, target, patch)
	if err != nil {
		return err
	}
	current.Set(nil, lastKey, merged)
	return nil
}

// appendArrayValues returns a new TypeArray containing all elements of a followed by all of b.
func appendArrayValues(a, b *astjson.Value) *astjson.Value {
	out := astjson.ArrayValue(nil)
	idx := 0
	for _, v := range a.GetArray() {
		out.SetArrayItem(nil, idx, v)
		idx++
	}
	for _, v := range b.GetArray() {
		out.SetArrayItem(nil, idx, v)
		idx++
	}
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
