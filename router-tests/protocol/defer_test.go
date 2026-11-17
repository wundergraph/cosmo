package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// plainJSONDeferQueries only defer fields that are also selected outside the
// fragment, so normalization removes the defer and the router answers with a
// regular JSON response.
var plainJSONDeferQueries = map[string]struct{}{
	"findEmployees_defer_09_duplicated_field_across_defer":           {},
	"findEmployeesNoCriteria_defer_09_duplicated_field_across_defer": {},
}

// TestDeferTestDataQueries runs every query variant in testdata/queries_defer.
// Each variant must reconstruct to its family's <source>_original.json, and
// every multipart response must follow the incremental delivery protocol. The
// checks do not depend on part order, defer IDs or how patches are grouped, so
// parallel defers need no exceptions and no per-variant snapshots.
func TestDeferTestDataQueries(t *testing.T) {
	t.Parallel()

	testDir := filepath.Join("testdata", "queries_defer")
	entries, err := os.ReadDir(testDir)
	require.NoError(t, err)

	groupQueries := map[string][]string{}

	for _, entry := range entries {
		name, ok := strings.CutSuffix(entry.Name(), ".graphql")
		if !ok {
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
	require.Len(t, groups, 9)

	for _, group := range groups {
		t.Run(group, func(t *testing.T) {
			// Every defer variant must reconstruct the same response as the query
			// without @defer.
			expected, err := os.ReadFile(filepath.Join(testDir, group+"_original.json"))
			require.NoError(t, err)

			for _, name := range groupQueries[group] {
				t.Run(name, func(t *testing.T) {
					t.Parallel()

					testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
						query, err := os.ReadFile(filepath.Join(testDir, name+".graphql"))
						require.NoError(t, err)

						payload, err := json.Marshal(map[string]any{"query": string(query)})
						require.NoError(t, err)

						req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
						res, err := xEnv.RouterClient.Do(req)
						require.NoError(t, err)
						defer func() { require.NoError(t, res.Body.Close()) }()

						require.Equal(t, http.StatusOK, res.StatusCode)

						body, err := io.ReadAll(res.Body)
						require.NoError(t, err)

						mediaType, params, err := mime.ParseMediaType(res.Header.Get("Content-Type"))
						require.NoError(t, err)

						if _, ok := plainJSONDeferQueries[name]; ok {
							require.Equal(t, "application/json", mediaType)
							require.JSONEq(t, string(expected), string(body))
							return
						}

						require.Equal(t, "multipart/mixed", mediaType)
						require.Equal(t, deferIncrementalSpec, params["incrementalspec"])

						parts, err := parseMultipartParts(body, params["boundary"])
						require.NoError(t, err, "body: %s", body)
						require.NoError(t, validateDeferParts(parts), "body: %s", body)
						// A response that announces nothing deferred would also pass the
						// protocol checks, so require at least one deferred payload.
						require.GreaterOrEqual(t, len(parts), 2, "nothing was deferred: %s", body)

						reconstructed, err := reconstructDeferResponse(parts)
						require.NoError(t, err)
						require.JSONEq(t, string(expected), string(reconstructed))
					})
				})
			}
		})
	}
}

// deferIncrementalSpec is the incremental delivery format the router announces.
const deferIncrementalSpec = "v0.2"

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
func reconstructDeferResponse(parts [][]byte) ([]byte, error) {
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
			return fmt.Errorf("mergeAtPath: segment %q not found in %v", key, pathKeys)
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

// parseMultipartParts reads the body with the same MIME framing a client uses.
// An empty part, a part that is not JSON or a missing closing boundary is an error.
func parseMultipartParts(body []byte, boundary string) ([][]byte, error) {
	if boundary == "" {
		return nil, fmt.Errorf("missing multipart boundary")
	}
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	var parts [][]byte
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return parts, nil
		}
		if err != nil {
			return nil, fmt.Errorf("read multipart part %d: %w", len(parts), err)
		}
		mediaType, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			return nil, fmt.Errorf("multipart part %d has Content-Type %q", len(parts), part.Header.Get("Content-Type"))
		}
		payload, err := io.ReadAll(part)
		if err != nil {
			return nil, fmt.Errorf("read multipart part %d: %w", len(parts), err)
		}
		if !json.Valid(payload) {
			return nil, fmt.Errorf("multipart part %d contains invalid JSON: %q", len(parts), payload)
		}
		parts = append(parts, payload)
	}
}

// validateDeferParts checks the incremental delivery protocol without fixing
// the order of parallel fragments, their IDs or how patches are grouped: every
// patched or completed ID must be pending, no ID is announced twice, and
// hasNext is true exactly while fragments are pending and parts remain.
func validateDeferParts(parts [][]byte) error {
	announced, pending := map[string]bool{}, map[string]bool{}
	for i, part := range parts {
		var payload struct {
			Data    json.RawMessage `json:"data"`
			HasNext *bool           `json:"hasNext"`
			Pending []struct {
				ID   string            `json:"id"`
				Path []json.RawMessage `json:"path"`
			} `json:"pending"`
			Incremental []struct {
				ID string `json:"id"`
			} `json:"incremental"`
			Completed []struct {
				ID string `json:"id"`
			} `json:"completed"`
		}
		if err := json.Unmarshal(part, &payload); err != nil {
			return fmt.Errorf("decode part %d: %w", i, err)
		}
		if i == 0 && len(payload.Data) == 0 {
			return fmt.Errorf("initial part has no data")
		}
		for _, entry := range payload.Pending {
			if entry.ID == "" || announced[entry.ID] || entry.Path == nil {
				return fmt.Errorf("part %d has invalid or duplicate pending id %q", i, entry.ID)
			}
			announced[entry.ID], pending[entry.ID] = true, true
		}
		for _, entry := range payload.Incremental {
			if !pending[entry.ID] {
				return fmt.Errorf("part %d patches inactive id %q", i, entry.ID)
			}
		}
		for _, entry := range payload.Completed {
			if !pending[entry.ID] {
				return fmt.Errorf("part %d completes inactive id %q", i, entry.ID)
			}
			delete(pending, entry.ID)
		}
		if payload.HasNext == nil {
			return fmt.Errorf("part %d is missing hasNext", i)
		}
		if last := i == len(parts)-1; *payload.HasNext == last || *payload.HasNext != (len(pending) > 0) {
			return fmt.Errorf("part %d has hasNext=%v with %d pending fragments and %d remaining parts", i, *payload.HasNext, len(pending), len(parts)-i-1)
		}
	}
	return nil
}

func TestDeferResponseValidation(t *testing.T) {
	t.Parallel()

	const header = "--graphql\r\nContent-Type: application/json\r\n\r\n"
	const initial = `{"data":{"user":{"id":"1"}},"pending":[{"id":"0","path":["user"]}],"hasNext":true}`
	const final = `{"incremental":[{"id":"0","data":{"name":"Ada"}}],"completed":[{"id":"0"}],"hasNext":false}`
	const wire = header + initial + "\r\n" + header + final + "\r\n--graphql--"

	for _, tc := range []struct {
		name string
		body string
		err  string
	}{
		{name: "valid", body: wire},
		{name: "empty final part", body: strings.TrimSuffix(wire, "--graphql--") + header + "\r\n--graphql--", err: "invalid JSON"},
		{name: "missing close", body: strings.TrimSuffix(wire, "\r\n--graphql--"), err: "EOF"},
		{name: "part without Content-Type", body: strings.Replace(wire, "Content-Type: application/json\r\n\r\n"+final, "\r\n"+final, 1), err: "Content-Type"},
		{name: "unknown patch id", body: strings.Replace(wire, `"incremental":[{"id":"0"`, `"incremental":[{"id":"9"`, 1), err: "patches inactive id"},
		{name: "fragment never completed", body: strings.Replace(wire, `,"completed":[{"id":"0"}]`, "", 1), err: "1 pending fragments"},
		{name: "hasNext false before last part", body: strings.Replace(wire, `"hasNext":true`, `"hasNext":false`, 1), err: "hasNext=false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			parts, err := parseMultipartParts([]byte(tc.body), "graphql")
			if err == nil {
				err = validateDeferParts(parts)
			}
			if tc.err != "" {
				require.ErrorContains(t, err, tc.err)
				return
			}
			require.NoError(t, err)
			result, err := reconstructDeferResponse(parts)
			require.NoError(t, err)
			require.JSONEq(t, `{"data":{"user":{"id":"1","name":"Ada"}}}`, string(result))
		})
	}
}
