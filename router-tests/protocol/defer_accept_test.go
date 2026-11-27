package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

// TestDeferAcceptHeader verifies how the router negotiates the Accept header of
// a query containing @defer: multipart/mixed without a format version, with the
// supported incrementalSpec, or a wildcard streams the response; a missing
// multipart/mixed is rejected with DEFER_BAD_HEADER (mirroring Apollo Router);
// an unsupported format such as Apollo Client's Defer20220824Handler header is
// rejected with DEFER_UNSUPPORTED_SPEC instead of letting the client drop the
// deferred data silently.
func TestDeferAcceptHeader(t *testing.T) {
	t.Parallel()

	const deferQuery = `query { employees { id ... @defer { isAvailable } } }`

	send := func(t *testing.T, xEnv *testenv.Environment, accept string) (*http.Response, string) {
		t.Helper()

		payload, err := json.Marshal(map[string]any{"query": deferQuery})
		require.NoError(t, err)

		req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(payload))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		if accept != "" {
			req.Header.Set("Accept", accept)
		}

		res, err := xEnv.RouterClient.Do(req)
		require.NoError(t, err)
		defer func() { require.NoError(t, res.Body.Close()) }()

		body, err := io.ReadAll(res.Body)
		require.NoError(t, err)

		return res, string(body)
	}

	streams := []struct {
		name   string
		accept string
	}{
		{name: "bare multipart/mixed", accept: "multipart/mixed"},
		{name: "Apollo Client GraphQL17Alpha9Handler", accept: "multipart/mixed;incrementalSpec=v0.2,application/graphql-response+json,application/json;q=0.9"},
		{name: "any wildcard", accept: "*/*"},
		{name: "no Accept header", accept: ""},
	}

	for _, tc := range streams {
		t.Run("streams with "+tc.name, func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
				res, body := send(t, xEnv, tc.accept)

				assert.Equal(t, http.StatusOK, res.StatusCode)
				assert.Equal(t, `multipart/mixed; boundary="graphql"; incrementalSpec=v0.2`, res.Header.Get("Content-Type"))
				assert.True(t, strings.HasPrefix(body, "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":"), body)
				assert.True(t, strings.HasSuffix(body, "\"hasNext\":false}\r\n--graphql--"), body)
			})
		})
	}

	t.Run("rejects when Accept is application/json", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
			res, body := send(t, xEnv, "application/json")

			assert.Equal(t, http.StatusOK, res.StatusCode)
			assert.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "application/json"),
				"expected application/json, got %q", res.Header.Get("Content-Type"))
			assert.Equal(t, `{"errors":[{"message":"the router received a query with the @defer directive but the client does not accept multipart/mixed HTTP responses. To enable @defer support, add the HTTP header 'Accept: multipart/mixed'","extensions":{"code":"DEFER_BAD_HEADER"}}]}`, body)
		})
	})

	t.Run("rejects Apollo Client Defer20220824Handler", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
			res, body := send(t, xEnv, "multipart/mixed;deferSpec=20220824,application/graphql-response+json,application/json;q=0.9")

			// The client accepts application/graphql-response+json, so the error uses
			// that media type and the status code of the GraphQL over HTTP spec.
			assert.Equal(t, http.StatusNotAcceptable, res.StatusCode)
			assert.Equal(t, "application/graphql-response+json; charset=utf-8", res.Header.Get("Content-Type"))
			assert.Equal(t, `{"errors":[{"message":"the router received a query with the @defer directive but the client requested the incremental delivery format 'deferSpec=20220824', while the router implements 'incrementalSpec=v0.2'. Use a client that supports this format, for example Apollo Client with GraphQL17Alpha9Handler","extensions":{"code":"DEFER_UNSUPPORTED_SPEC"}}]}`, body)
		})
	})
}

// TestDeferErrorAfterStreamStarted verifies that an error after the initial
// payload leaves the multipart stream unterminated instead of appending an
// error response, which would add an empty part and an untagged error part.
func TestDeferErrorAfterStreamStarted(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		NoRetryClient: true,
		Subgraphs: testenv.SubgraphsConfig{
			Availability: testenv.SubgraphConfig{Delay: 2 * time.Second},
		},
		RouterOptions: []core.Option{
			core.WithCustomModules(&requestDeadlineModule{timeout: 500 * time.Millisecond}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		payload, err := json.Marshal(map[string]any{"query": `query { employees { id ... @defer { isAvailable } } }`})
		require.NoError(t, err)

		req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(payload))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "multipart/mixed;incrementalSpec=v0.2,application/json;q=0.9")

		res, err := xEnv.RouterClient.Do(req)
		require.NoError(t, err)
		defer func() { require.NoError(t, res.Body.Close()) }()

		body, err := io.ReadAll(res.Body)
		require.NoError(t, err)

		require.Equal(t, http.StatusOK, res.StatusCode)
		assert.True(t, strings.HasPrefix(string(body), "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":"), string(body))
		assert.True(t, strings.HasSuffix(string(body), "\"hasNext\":true}\r\n--graphql\r\n"), string(body))
		assert.NotContains(t, string(body), "--graphql--")
		assert.NotContains(t, string(body), "\"errors\"")
	})
}

var (
	_ core.Module                 = (*requestDeadlineModule)(nil)
	_ core.RouterOnRequestHandler = (*requestDeadlineModule)(nil)
)

// requestDeadlineModule bounds every request with a deadline, so execution
// fails with context.DeadlineExceeded rather than context.Canceled.
type requestDeadlineModule struct {
	timeout time.Duration
}

func (m *requestDeadlineModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "requestDeadlineModule",
		Priority: 1,
		New: func() core.Module {
			return &requestDeadlineModule{timeout: m.timeout}
		},
	}
}

func (m *requestDeadlineModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	reqCtx, cancel := context.WithTimeout(ctx.Request().Context(), m.timeout)
	defer cancel()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request().WithContext(reqCtx))
}

// TestDeferWithoutFetchIsNotAnnounced verifies that a defer needing no fetch
// never leaves an announced defer without a final payload: alone it does not
// open a multipart stream, and next to or inside a defer with a fetch it is
// rendered in the initial payload while the stream still closes with hasNext:false.
func TestDeferWithoutFetchIsNotAnnounced(t *testing.T) {
	t.Parallel()

	send := func(t *testing.T, xEnv *testenv.Environment, query string) (*http.Response, string) {
		t.Helper()

		payload, err := json.Marshal(map[string]any{"query": query})
		require.NoError(t, err)

		req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(payload))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "multipart/mixed;incrementalSpec=v0.2,application/json;q=0.9")

		res, err := xEnv.RouterClient.Do(req)
		require.NoError(t, err)
		defer func() { require.NoError(t, res.Body.Close()) }()

		body, err := io.ReadAll(res.Body)
		require.NoError(t, err)

		return res, string(body)
	}

	t.Run("only defer needs no fetch", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
			res, body := send(t, xEnv, `query { employees { id ... @defer { __typename } } }`)
			require.Equal(t, http.StatusOK, res.StatusCode)
			assert.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "application/json"), res.Header.Get("Content-Type"))
			assert.JSONEq(t, `{"data":{"employees":[{"id":1,"__typename":"Employee"},{"id":2,"__typename":"Employee"},{"id":3,"__typename":"Employee"},{"id":4,"__typename":"Employee"},{"id":5,"__typename":"Employee"},{"id":7,"__typename":"Employee"},{"id":8,"__typename":"Employee"},{"id":10,"__typename":"Employee"},{"id":11,"__typename":"Employee"},{"id":12,"__typename":"Employee"}]}}`, body)
		})
	})

	for _, tc := range []struct {
		name  string
		query string
	}{
		{name: "next to a defer with a fetch", query: `query { employee(id: 1) { id ... @defer { __typename } ... @defer { details { forename } } } }`},
		{name: "inside a defer with a fetch", query: `query { employee(id: 1) { id ... @defer { details { forename } ... @defer { __typename } } } }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{NoRetryClient: true}, func(t *testing.T, xEnv *testenv.Environment) {
				res, body := send(t, xEnv, tc.query)
				require.Equal(t, http.StatusOK, res.StatusCode)
				assert.Equal(t, `multipart/mixed; boundary="graphql"; incrementalSpec=v0.2`, res.Header.Get("Content-Type"))
				assert.True(t, strings.HasPrefix(body, "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"employee\":{\"id\":1,\"__typename\":\"Employee\"}},\"pending\":[{\"id\":"), body)
				assert.Equal(t, 1, strings.Count(body, `"path":`), "only the defer with a fetch may be announced: %s", body)
				assert.True(t, strings.HasSuffix(body, "\"hasNext\":false}\r\n--graphql--"), body)
			})
		})
	}
}
