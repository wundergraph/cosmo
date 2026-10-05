package cdn

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersistedOperationIDRoundTrip(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"get_employee-1.2.3", " !\"#$%&'()*+,-.:;<=>?@[]^_{}|~ ", "%2F", "%252F", ".", "..", strings.Repeat(".", 250)} {
		t.Run(id, func(t *testing.T) {
			const clientName = "web / %2F"
			transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
				// Parse the wire URL, as an HTTP server would.
				wireURL, err := url.Parse(r.URL.String())
				require.NoError(t, err)
				r.URL = wireURL
				assert.Equal(t, "/org/graph/operations/"+clientName+"/"+id+".json", r.URL.Path)
				assert.Equal(t, "", r.URL.RawQuery)
				assert.Equal(t, "", r.URL.Fragment)
				segments := strings.Split(r.URL.EscapedPath(), "/")
				if assert.Len(t, segments, 6) {
					decodedID, err := url.PathUnescape(strings.TrimSuffix(segments[5], ".json"))
					assert.NoError(t, err)
					assert.Equal(t, id, decodedID)
				}
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header),
					Body: io.NopCloser(strings.NewReader(`{"version":1,"body":"query { a }"}`))}, nil
			})
			endpoint, err := url.Parse("https://cdn.example.com")
			require.NoError(t, err)
			client := &Client{cdnURL: endpoint, organizationID: "org", federatedGraphID: "graph", httpClient: &http.Client{Transport: transport}}
			body, err := client.PersistedOperation(t.Context(), clientName, id)
			require.NoError(t, err)
			assert.Equal(t, "query { a }", string(body))
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
