package core

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeferAccept(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		accept  string
		verdict deferAcceptVerdict
		spec    string
	}{
		{name: "no Accept header", accept: "", verdict: deferAcceptCompatible},
		{name: "bare multipart/mixed", accept: "multipart/mixed", verdict: deferAcceptCompatible},
		{name: "supported incrementalSpec", accept: "multipart/mixed;incrementalSpec=v0.2", verdict: deferAcceptCompatible},
		{name: "supported incrementalSpec with spaces and other params", accept: "multipart/mixed; boundary=graphql; incrementalSpec=v0.2", verdict: deferAcceptCompatible},
		{name: "Apollo Client GraphQL17Alpha9Handler", accept: "multipart/mixed;incrementalSpec=v0.2,application/graphql-response+json,application/json;q=0.9", verdict: deferAcceptCompatible},
		{name: "Apollo Client Defer20220824Handler", accept: "multipart/mixed;deferSpec=20220824,application/graphql-response+json,application/json;q=0.9", verdict: deferAcceptUnsupportedSpec, spec: "deferSpec=20220824"},
		{name: "other incrementalSpec version", accept: "multipart/mixed;incrementalSpec=v0.1", verdict: deferAcceptUnsupportedSpec, spec: "incrementalSpec=v0.1"},
		{name: "both supported and unsupported elements", accept: "multipart/mixed;deferSpec=20220824, multipart/mixed;incrementalSpec=v0.2", verdict: deferAcceptCompatible},
		{name: "unsupported spec next to a wildcard", accept: "multipart/mixed;deferSpec=20220824, */*", verdict: deferAcceptUnsupportedSpec, spec: "deferSpec=20220824"},
		{name: "any wildcard", accept: "*/*", verdict: deferAcceptCompatible},
		{name: "multipart wildcard", accept: "multipart/*", verdict: deferAcceptCompatible},
		{name: "json with wildcard fallback", accept: "application/json, */*;q=0.1", verdict: deferAcceptCompatible},
		{name: "json only", accept: "application/json", verdict: deferAcceptNoMultipart},
		{name: "unparsable element is ignored", accept: "multipart/mixed;=broken, application/json", verdict: deferAcceptNoMultipart},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req, err := http.NewRequest(http.MethodPost, "http://router.local/graphql", nil)
			require.NoError(t, err)
			if tc.accept != "" {
				req.Header.Set("Accept", tc.accept)
			}

			verdict, spec := deferAccept(req)
			assert.Equal(t, tc.verdict, verdict)
			assert.Equal(t, tc.spec, spec)
		})
	}
}
