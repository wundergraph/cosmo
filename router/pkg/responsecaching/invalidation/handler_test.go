package invalidation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

const testKey = "a-shared-key-that-is-long-enough-to-pass"

// recordingInvalidator stands in for a store, so what the handler decided to
// remove can be asserted on directly rather than inferred from a count.
type recordingInvalidator struct {
	tags    []string
	removed int
	err     error
	calls   int
}

func (r *recordingInvalidator) InvalidateByTags(_ context.Context, tags []string) (int, error) {
	r.calls++
	r.tags = append(r.tags, tags...)
	return r.removed, r.err
}

// allIndexes is an endpoint that is on and maintains every index.
func allIndexes() config.ResponseCacheInvalidationConfig {
	return config.ResponseCacheInvalidationConfig{
		CacheTag: true,
		Subgraph: true,
		Type:     true,
		Endpoint: config.ResponseCacheInvalidationEndpointConfig{
			Enabled:    true,
			ListenAddr: "127.0.0.1:0",
			Path:       "/invalidation",
			SharedKey:  testKey,
		},
	}
}

// post runs one request and returns the response, so both what was answered and
// what the store was asked to remove are visible to the caller.
func post(t *testing.T, cfg config.ResponseCacheInvalidationConfig, store *recordingInvalidator, key, body string) *httptest.ResponseRecorder {
	t.Helper()

	r := httptest.NewRequest(http.MethodPost, "/invalidation", strings.NewReader(body))
	if key != "" {
		r.Header.Set("Authorization", key)
	}

	w := httptest.NewRecorder()
	NewHandler(zap.NewNop(), store, cfg).ServeHTTP(w, r)
	return w
}

func decodeErrors(t *testing.T, w *httptest.ResponseRecorder) []Error {
	t.Helper()
	var body errorResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return body.Errors
}

func TestHandlerKinds(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		body string
		tags []string
	}{
		{
			name: "a subgraph request names the subgraph index",
			body: `[{"kind":"subgraph","subgraph":"accounts"}]`,
			tags: []string{"subgraph:accounts"},
		},
		{
			name: "a type request is scoped to the subgraph that answered",
			body: `[{"kind":"type","subgraph":"accounts","type":"User"}]`,
			tags: []string{"type:accounts:User"},
		},
		{
			name: "a cache tag request names one tag per subgraph it applies to",
			body: `[{"kind":"cache_tag","subgraphs":["accounts","products"],"cache_tag":"profile"}]`,
			tags: []string{"declared:accounts:profile", "declared:products:profile"},
		},
		{
			name: "requests are applied together",
			body: `[{"kind":"subgraph","subgraph":"accounts"},{"kind":"type","subgraph":"products","type":"Product"}]`,
			tags: []string{"subgraph:accounts", "type:products:Product"},
		},
		{
			name: "a tag named twice is looked up once",
			body: `[{"kind":"subgraph","subgraph":"accounts"},{"kind":"subgraph","subgraph":"accounts"}]`,
			tags: []string{"subgraph:accounts"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingInvalidator{removed: 7}

			w := post(t, allIndexes(), store, testKey, tc.body)

			require.Equal(t, http.StatusAccepted, w.Code, w.Body.String())
			require.Equal(t, tc.tags, store.tags)

			var body countResponse
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 7, body.Count)
		})
	}
}

// A type or a tag is indexed per subgraph, so there is no way to name one across
// the whole graph. The request is refused rather than quietly widened.
func TestHandlerRequiresASubgraph(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		body string
	}{
		{"a type without a subgraph", `[{"kind":"type","type":"User"}]`},
		{"a cache tag without subgraphs", `[{"kind":"cache_tag","cache_tag":"profile"}]`},
		{"a subgraph request without a subgraph", `[{"kind":"subgraph"}]`},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingInvalidator{}

			w := post(t, allIndexes(), store, testKey, tc.body)

			require.Equal(t, http.StatusBadRequest, w.Code)
			require.Zero(t, store.calls)
			require.Contains(t, decodeErrors(t, w)[0].Message, "requires")
		})
	}
}

func TestHandlerAuthorization(t *testing.T) {
	t.Parallel()

	const body = `[{"kind":"subgraph","subgraph":"accounts"}]`

	testCases := []struct {
		name string
		key  string
	}{
		{"no header", ""},
		{"a wrong key", "not-the-key-but-long-enough-to-look-real"},
		{"the key behind a Bearer prefix", "Bearer " + testKey},
		{"a prefix of the key", testKey[:16]},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingInvalidator{}

			w := post(t, allIndexes(), store, tc.key, body)

			require.Equal(t, http.StatusUnauthorized, w.Code)
			require.Zero(t, store.calls, "nothing may be removed for an unauthorized caller")
		})
	}

	t.Run("the key is checked before the body is read", func(t *testing.T) {
		// Otherwise an unauthorized caller can make the router parse megabytes
		// on its say so.
		t.Parallel()
		store := &recordingInvalidator{}

		w := post(t, allIndexes(), store, "wrong", `this is not even json`)

		require.Equal(t, http.StatusUnauthorized, w.Code, "not 400: the body was never looked at")
	})
}

// An index that is not built cannot be read, so a request naming it is refused
// rather than answered with a count of nothing, which would read as "there was
// nothing to remove" instead of "you cannot ask that".
func TestHandlerDisabledIndex(t *testing.T) {
	t.Parallel()

	cacheTagOnly := allIndexes()
	cacheTagOnly.Subgraph = false
	cacheTagOnly.Type = false

	testCases := []struct {
		name string
		body string
		kind Kind
	}{
		{"the type index", `[{"kind":"type","subgraph":"accounts","type":"User"}]`, KindType},
		{"the subgraph index", `[{"kind":"subgraph","subgraph":"accounts"}]`, KindSubgraph},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingInvalidator{}

			w := post(t, cacheTagOnly, store, testKey, tc.body)

			require.Equal(t, http.StatusBadRequest, w.Code)
			require.Zero(t, store.calls)

			errs := decodeErrors(t, w)
			require.Len(t, errs, 1)
			require.Equal(t, tc.kind, errs[0].Kind, "the error has to name the kind that was refused")
			require.Contains(t, errs[0].Message, "not maintained")
		})
	}

	t.Run("the index it does maintain is still invalidatable", func(t *testing.T) {
		t.Parallel()
		store := &recordingInvalidator{removed: 1}

		w := post(t, cacheTagOnly, store, testKey, `[{"kind":"cache_tag","subgraphs":["accounts"],"cache_tag":"profile"}]`)

		require.Equal(t, http.StatusAccepted, w.Code, w.Body.String())
		require.Equal(t, []string{"declared:accounts:profile"}, store.tags)
	})
}

func TestHandlerValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		body     string
		contains string
	}{
		{"an unknown kind", `[{"kind":"entity","subgraph":"accounts"}]`, `unknown kind "entity"`},
		{"a missing kind", `[{"subgraph":"accounts"}]`, `unknown kind ""`},
		{"a type without a type", `[{"kind":"type","subgraph":"accounts"}]`, "requires a type"},
		{"a cache tag without a tag", `[{"kind":"cache_tag","subgraphs":["accounts"]}]`, "requires a cache_tag"},
		{"a cache tag naming an empty subgraph", `[{"kind":"cache_tag","subgraphs":[""],"cache_tag":"p"}]`, "empty subgraph"},
		{"an unknown field", `[{"kind":"subgraph","subgraph":"accounts","extra":1}]`, "array of requests"},
		{"an object rather than an array", `{"kind":"subgraph","subgraph":"accounts"}`, "array of requests"},
		{"an empty array", `[]`, "at least one request"},
		{"nothing at all", ``, "array of requests"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &recordingInvalidator{}

			w := post(t, allIndexes(), store, testKey, tc.body)

			require.Equal(t, http.StatusBadRequest, w.Code)
			require.Zero(t, store.calls)
			require.Contains(t, decodeErrors(t, w)[0].Message, tc.contains)
		})
	}

	t.Run("one bad element leaves the whole array unapplied", func(t *testing.T) {
		// Applying as far as the first refusal would leave a caller half
		// invalidated by a typo, with no safe way to retry the whole array.
		t.Parallel()
		store := &recordingInvalidator{}

		w := post(t, allIndexes(), store, testKey,
			`[{"kind":"subgraph","subgraph":"accounts"},{"kind":"nope"}]`)

		require.Equal(t, http.StatusBadRequest, w.Code)
		require.Zero(t, store.calls, "the good element must not have been applied either")

		errs := decodeErrors(t, w)
		require.Len(t, errs, 1)
		require.Equal(t, 1, errs[0].Index, "the error has to say which element it was")
	})

	t.Run("every bad element is reported, not just the first", func(t *testing.T) {
		t.Parallel()
		store := &recordingInvalidator{}

		w := post(t, allIndexes(), store, testKey,
			`[{"kind":"nope"},{"kind":"type","subgraph":"accounts"}]`)

		require.Equal(t, http.StatusBadRequest, w.Code)
		errs := decodeErrors(t, w)
		require.Len(t, errs, 2)
		require.Equal(t, 0, errs[0].Index)
		require.Equal(t, 1, errs[1].Index)
	})
}

func TestHandlerMethod(t *testing.T) {
	t.Parallel()

	store := &recordingInvalidator{}
	r := httptest.NewRequest(http.MethodGet, "/invalidation", nil)
	r.Header.Set("Authorization", testKey)
	w := httptest.NewRecorder()
	NewHandler(zap.NewNop(), store, allIndexes()).ServeHTTP(w, r)

	require.Equal(t, http.StatusMethodNotAllowed, w.Code)
	require.Equal(t, http.MethodPost, w.Header().Get("Allow"))
	require.Zero(t, store.calls)
}

func TestHandlerStoreFailure(t *testing.T) {
	t.Parallel()

	store := &recordingInvalidator{removed: 3, err: errors.New("redis is unreachable")}

	w := post(t, allIndexes(), store, testKey, `[{"kind":"subgraph","subgraph":"accounts"}]`)

	require.Equal(t, http.StatusInternalServerError, w.Code)
	// The store's own error is not echoed: it names hosts and keys a caller of
	// this endpoint has no business seeing. The logs carry it instead.
	require.NotContains(t, w.Body.String(), "redis is unreachable")
	require.Contains(t, decodeErrors(t, w)[0].Message, "router logs")
}

// The endpoint is only ever built with a key, because an empty one compares
// equal to an absent Authorization header and would authorize everything.
func TestNewServerRequiresASharedKey(t *testing.T) {
	t.Parallel()

	cfg := allIndexes()
	cfg.Endpoint.SharedKey = ""

	svr, err := NewServer(zap.NewNop(), cfg, &recordingInvalidator{})
	require.Error(t, err)
	require.Nil(t, svr)
	require.Contains(t, err.Error(), "shared_key")
}
