package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

const providesUnionRouterConfigJSONTemplate = `{"engineConfig":{"defaultFlushInterval":"500","datasourceConfigurations":[{"kind":"GRAPHQL","rootNodes":[{"typeName":"Query","fieldNames":["media"]},{"typeName":"Book","fieldNames":["id"],"externalFieldNames":["title"]},{"typeName":"Movie","fieldNames":["id"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4006/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4006/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Query {\n  media: [Media] @shareable @provides(fields: \"... on Book { title }\")\n}\n\nunion Media = Book | Movie\n\ntype Book @key(fields: \"id\") {\n  id: ID!\n  title: String! @external\n}\n\ntype Movie @key(fields: \"id\") {\n  id: ID!\n}\n"},"upstreamSchema":{"key":"c08029e34d233a0a17138135eea97f03a3fe034a"}},"requestTimeoutSeconds":"10","id":"0","keys":[{"typeName":"Book","selectionSet":"id"},{"typeName":"Movie","selectionSet":"id"}],"provides":[{"typeName":"Query","fieldName":"media","selectionSet":"... on Book { title }"}]},{"kind":"GRAPHQL","rootNodes":[{"typeName":"Query","fieldNames":["_empty"]},{"typeName":"Book","fieldNames":["id","title"]},{"typeName":"Movie","fieldNames":["id"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4004/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4004/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Query {\n  _empty: String\n}\n\ntype Book @key(fields: \"id\") {\n  id: ID!\n  title: String!\n}\n\ntype Movie @key(fields: \"id\") {\n  id: ID!\n}\n"},"upstreamSchema":{"key":"635397e33a1d340e43a29be09947aa91e35aab93"}},"requestTimeoutSeconds":"10","id":"1","keys":[{"typeName":"Book","selectionSet":"id"},{"typeName":"Movie","selectionSet":"id"}]}],"graphqlSchema":"schema {\n  query: Query\n}\n\ntype Query {\n  media: [Media]\n  _empty: String\n}\n\nunion Media = Book | Movie\n\ntype Book {\n  id: ID!\n  title: String!\n}\n\ntype Movie {\n  id: ID!\n}","stringStorage":{"c08029e34d233a0a17138135eea97f03a3fe034a":"schema {\n  query: Query\n}\n\ndirective @external on FIELD_DEFINITION | OBJECT\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ndirective @shareable repeatable on FIELD_DEFINITION | OBJECT\n\ntype Book @key(fields: \"id\") {\n  id: ID!\n  title: String! @external\n}\n\nunion Media = Book | Movie\n\ntype Movie @key(fields: \"id\") {\n  id: ID!\n}\n\ntype Query {\n  media: [Media] @shareable @provides(fields: \"... on Book { title }\")\n}\n\nscalar openfed__FieldSet","635397e33a1d340e43a29be09947aa91e35aab93":"schema {\n  query: Query\n}\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ntype Book @key(fields: \"id\") {\n  id: ID!\n  title: String!\n}\n\ntype Movie @key(fields: \"id\") {\n  id: ID!\n}\n\ntype Query {\n  _empty: String\n}\n\nscalar openfed__FieldSet"}},"version":"00000000-0000-0000-0000-000000000000","subgraphs":[{"id":"0","name":"test1","routingUrl":"http://localhost:4006/graphql"},{"id":"1","name":"products","routingUrl":"http://localhost:4004/graphql"}],"compatibilityVersion":"1:{{$COMPOSITION__VERSION}}"}`

func TestProvidesFieldSetOverUnionTypedField(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: providesUnionRouterConfigJSONTemplate,
		Subgraphs: testenv.SubgraphsConfig{
			Test1: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))
						require.Equal(t, `{media {__typename ... on Book {id title} ... on Movie {id}}}`, req.Query)
						require.Empty(t, req.Variables)

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"media":[{"__typename":"Book","id":"book-1","title":"Dune"},{"__typename":"Movie","id":"movie-1"}]}}`))
					})
				},
			},
			Products: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))

						t.Fatalf("unexpected request to owner subgraph: query=%s variables=%s", req.Query, string(req.Variables))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ media { ... on Book { id title } ... on Movie { id } } }`,
		})

		require.Equal(t, `{"data":{"media":[{"id":"book-1","title":"Dune"},{"id":"movie-1"}]}}`, res.Body)
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Products.Load())
	})
}
