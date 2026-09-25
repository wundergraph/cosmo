package core

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
)

func TestCustomPersistedIDValidation(t *testing.T) {
	t.Parallel()

	store, err := apq.NewMemoryStore(1024*1024, time.Minute)
	require.NoError(t, err)
	apqClient, err := persistedoperation.NewClient(&persistedoperation.Options{APQStore: store})
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, apqClient.Close()) })
	publishedClient := &persistedoperation.Client{}

	cases := []struct {
		name, id, query string
		client          *persistedoperation.Client
		valid           bool
	}{
		{name: "unconfigured rejects custom", id: "get_typename_v1"},
		{name: "APQ rejects custom", id: "get_typename_v1", client: apqClient},
		{name: "custom", id: "get_typename_v1", valid: true, client: publishedClient},
		{name: "maximum length", id: strings.Repeat("x", 250), valid: true, client: publishedClient},
		{name: "too long", id: strings.Repeat("x", 251), client: publishedClient},
		{name: "empty", client: publishedClient},
		{name: "path", id: "../test", client: publishedClient},
		{name: "space", id: "a b", client: publishedClient},
		{name: "unicode", id: "ä", client: publishedClient},
		{name: "body", id: "get_typename_v1", query: "{ __typename }", client: publishedClient},
		{name: "sha without APQ", id: strings.Repeat("a", 64), valid: true, client: publishedClient},
		{name: "sha with APQ", client: apqClient, id: strings.Repeat("a", 64), valid: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			kit := OperationKit{
				operationProcessor: &OperationProcessor{persistedOperationClient: tc.client},
				parsedOperation: &ParsedOperation{
					Request: GraphQLRequest{Query: tc.query},
					GraphQLRequestExtensions: GraphQLRequestExtensions{
						PersistedQuery: &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: tc.id},
					},
				},
			}
			err := kit.validatePersistedQueryID()
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}
