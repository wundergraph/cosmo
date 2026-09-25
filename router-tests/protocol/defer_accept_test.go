package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
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
				assert.True(t, strings.HasSuffix(body, "\"hasNext\":false}\r\n\r\n--graphql--"), body)
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

			assert.Equal(t, http.StatusOK, res.StatusCode)
			assert.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "application/json"),
				"expected application/json, got %q", res.Header.Get("Content-Type"))
			assert.Equal(t, `{"errors":[{"message":"the router received a query with the @defer directive but the client requested the incremental delivery format 'deferSpec=20220824', while the router implements 'incrementalSpec=v0.2'. Use a client that supports this format, for example Apollo Client with GraphQL17Alpha9Handler","extensions":{"code":"DEFER_UNSUPPORTED_SPEC"}}]}`, body)
		})
	})
}
