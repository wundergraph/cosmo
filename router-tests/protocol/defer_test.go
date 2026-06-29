package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
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

	groupQueries := map[string][]string{}

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

		groupQueries[source] = append(groupQueries[source], name)
	}

	groups := make([]string, 0, len(groupQueries))
	for k := range groupQueries {
		groups = append(groups, k)
	}
	slices.Sort(groups)

	for _, group := range groups {
		t.Run(group, func(t *testing.T) {
			for _, name := range groupQueries[group] {
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
							// cfg.Debug.PrintIntermediateQueryPlans = true
							// cfg.Debug.PrintPlanningPaths = true
							// cfg.Debug.PrintNodeSuggestions = true
							// cfg.Debug.PrintOperationTransformations = true
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

						skipRaw := func() bool {
							skips := []string{
								"extensive_parallel",
								"parallel_defers",
								"products_defer",
								"multiple_fields_deferred",
								// Two @defer on sibling root fields (employee + teammates)
								// resolve in parallel, so the chunk order is non-deterministic.
								// The single-defer *_08 variants are deterministic and keep
								// their raw assertion; products_defer_08 is already covered by
								// the "products_defer" prefix above.
								"employee_defer_08_defer_nested_object",
							}

							for _, skip := range skips {
								if strings.HasSuffix(name, skip) || strings.HasPrefix(name, skip) {
									return true
								}
							}

							return false
						}

						// skip checking non deterministic order of payloads
						if !skipRaw() {
							updateRaw := false

							t.Run("raw multipart body", func(t *testing.T) {

								body := bytes.Replace(body, []byte("\r\n"), []byte("\n"), -1)

								if !updateRaw {
									gMultipart.Assert(t, name, body)
								} else {
									gMultipart.Update(t, name, body)
								}
							})
						}

						var actual []byte

						if isMultipart {
							// Reconstruct the full response from chunks
							reconstructed, err := reconstructDeferResponse(body)
							require.NoError(t, err)
							actual = normalizeWithKeysSort(t, reconstructed)
						} else {
							actual = normalizeWithKeysSort(t, body)
						}

						updateFull := false

						t.Run("assert full response", func(t *testing.T) {
							if !updateFull {
								gFull.Assert(t, name+"_reconstructed", actual)
							} else {
								gFull.Update(t, name+"_reconstructed", actual)
							}
						})

						t.Run("compare with response without defer", func(t *testing.T) {
							expected, err := os.ReadFile(gFull.GoldenFileName(t, group+"_original"))
							require.NoError(t, err)

							expected = normalizeWithKeysSort(t, expected)
							actual = normalizeWithKeysSort(t, actual)

							// manually assert to never update the original when the update flag is specified
							if diff := goldie.Diff(goldie.ClassicDiff, string(actual), string(expected)); diff != "" {
								t.Fatal(diff)
							}
						})
					})
				})
			}
		})
	}
}

// TestDeferRejectsNonMultipartAccept verifies that a query containing the
// @defer directive is rejected with a DEFER_BAD_HEADER error when the client
// does not accept multipart/mixed responses (mirroring Apollo Router behavior).
func TestDeferRejectsNonMultipartAccept(t *testing.T) {
	t.Parallel()

	const deferQuery = `query { employees { id ... @defer { isAvailable } } }`

	t.Run("rejects when Accept is application/json", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
			payload, err := json.Marshal(map[string]any{"query": deferQuery})
			require.NoError(t, err)

			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(payload))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json")

			res, err := xEnv.RouterClient.Do(req)
			require.NoError(t, err)
			defer func() { require.NoError(t, res.Body.Close()) }()

			assert.Equal(t, http.StatusOK, res.StatusCode)
			assert.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "application/json"),
				"expected application/json, got %q", res.Header.Get("Content-Type"))

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			assert.Equal(t, `{"errors":[{"message":"the router received a query with the @defer directive but the client does not accept multipart/mixed HTTP responses. To enable @defer support, add the HTTP header 'Accept: multipart/mixed'","extensions":{"code":"DEFER_BAD_HEADER"}}]}`, string(body))
		})
	})

	t.Run("accepts when Accept is multipart/mixed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
			payload, err := json.Marshal(map[string]any{"query": deferQuery})
			require.NoError(t, err)

			req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
			res, err := xEnv.RouterClient.Do(req)
			require.NoError(t, err)
			defer func() { require.NoError(t, res.Body.Close()) }()

			assert.Equal(t, http.StatusOK, res.StatusCode)
			assert.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "multipart/mixed"),
				"expected multipart/mixed, got %q", res.Header.Get("Content-Type"))
		})
	})
}

func normalizeWithKeysSort(tb testing.TB, data []byte) []byte {
	var val map[string]interface{}
	require.NoError(tb, json.Unmarshal(data, &val))

	out, err := json.MarshalIndent(val, "", "  ")
	require.NoError(tb, err)

	return out
}

// reconstructDeferResponse parses a multipart/mixed defer body, merges all
// incremental patches onto the initial data using astjson, and returns
// the complete JSON response (without transport fields like hasNext/pending).
//
// Frame format (GraphQL incremental delivery):
//
//	initial:    {"data":{...},"pending":[{"id":"1","path":["user"],"label":"..."}],"hasNext":true}
//	subsequent: {"incremental":[{"data":{...},"id":"1","subPath":[0,"info"],"errors":[...]}],
//	             "completed":[{"id":"1","errors":[...]}],"hasNext":false}
//
// The merge target of an incremental item is pending[id].path + item.subPath.
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

	// pendingPaths maps defer id -> base path segments announced in "pending".
	pendingPaths := map[string][]string{}
	collectPending := func(v *astjson.Value) {
		for _, entry := range v.GetArray("pending") {
			id := string(entry.GetStringBytes("id"))
			var path []string
			for _, seg := range entry.GetArray("path") {
				path = append(path, pathSegmentKey(seg))
			}
			pendingPaths[id] = path
		}
	}
	collectPending(result)

	appendRootErrors := func(patchErrors *astjson.Value) {
		if patchErrors == nil || patchErrors.Type() != astjson.TypeArray {
			return
		}
		existing := result.Get("errors")
		if existing == nil || existing.Type() == astjson.TypeNull {
			result.Set(nil, "errors", patchErrors)
		} else {
			merged := appendArrayValues(existing, patchErrors)
			result.Set(nil, "errors", merged)
		}
	}

	for _, part := range parts[1:] {
		partVal, err := p.ParseBytes(part)
		if err != nil {
			return nil, fmt.Errorf("parse part: %w", err)
		}

		// New pending entries may be announced in subsequent payloads.
		collectPending(partVal)

		for _, item := range partVal.GetArray("incremental") {
			patchData := item.Get("data")
			if patchData == nil {
				continue
			}

			// Build path: "data", then the pending entry's path, then subPath.
			pathKeys := []string{"data"}
			if id := item.Get("id"); id != nil {
				idStr := string(id.GetStringBytes())
				base, ok := pendingPaths[idStr]
				if !ok {
					return nil, fmt.Errorf("incremental item references unknown pending id %q", idStr)
				}
				pathKeys = append(pathKeys, base...)
				for _, seg := range item.GetArray("subPath") {
					pathKeys = append(pathKeys, pathSegmentKey(seg))
				}
			} else {
				// Legacy format: the full path lives directly on the incremental item.
				for _, seg := range item.GetArray("path") {
					pathKeys = append(pathKeys, pathSegmentKey(seg))
				}
			}

			if err := mergeAtPath(result, patchData, pathKeys); err != nil {
				return nil, fmt.Errorf("merge at path %v: %w", pathKeys, err)
			}

			// Collect errors from incremental items into root errors.
			appendRootErrors(item.Get("errors"))
		}

		// completed entries carry errors when a deferred fragment was discarded
		// (e.g. a non-nullable field error inside the fragment).
		for _, item := range partVal.GetArray("completed") {
			appendRootErrors(item.Get("errors"))
		}
	}

	// Remove transport-only fields.
	result.Del("hasNext")
	result.Del("pending")

	return result.MarshalTo(nil), nil
}

// pathSegmentKey converts a path/subPath segment (string field name or integer
// list index) into a key usable with astjson Get/Set.
func pathSegmentKey(seg *astjson.Value) string {
	switch seg.Type() {
	case astjson.TypeNumber:
		return string(seg.MarshalTo(nil))
	default:
		s, _ := seg.StringBytes()
		return string(s)
	}
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
	// Each part is delimited by the --graphql boundary. The first part has no
	// leading CRLF (the body starts directly with the boundary), so we split on
	// the boundary itself rather than "\r\n--graphql". Empty leading segments and
	// the closing "--" terminator are skipped below.
	boundary := []byte("--graphql")
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
