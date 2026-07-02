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

const partialUnionIntersectionRouterConfigJSONTemplate = `{"engineConfig":{"defaultFlushInterval":"500","datasourceConfigurations":[{"kind":"GRAPHQL","rootNodes":[{"typeName":"Query","fieldNames":["container"]},{"typeName":"Container","fieldNames":["id","items"]}],"childNodes":[{"typeName":"Article","fieldNames":["id","title"]},{"typeName":"Image","fieldNames":["id","url"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4006/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4006/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Query {\n  container(id: ID!): Container\n}\n\ntype Container @key(fields: \"id\") {\n  id: ID!\n  items: [SearchResult!]! @shareable\n}\n\nunion SearchResult = Article | Image\n\ntype Article {\n  id: ID! @shareable\n  title: String! @shareable\n}\n\ntype Image {\n  id: ID!\n  url: String\n}\n"},"upstreamSchema":{"key":"2af0450b5f382d3fccc224c92327a67a51cac656"}},"requestTimeoutSeconds":"10","id":"0","keys":[{"typeName":"Container","selectionSet":"id"}]},{"kind":"GRAPHQL","rootNodes":[{"typeName":"Query","fieldNames":["_noop"]},{"typeName":"Container","fieldNames":["id","items"]}],"childNodes":[{"typeName":"Article","fieldNames":["id","title"]},{"typeName":"Video","fieldNames":["id","duration"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4004/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4004/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Query {\n  _noop: Boolean\n}\n\ntype Container @key(fields: \"id\") {\n  id: ID!\n  items: [SearchResult!]! @shareable\n}\n\nunion SearchResult = Article | Video\n\ntype Article {\n  id: ID! @shareable\n  title: String! @shareable\n}\n\ntype Video {\n  id: ID!\n  duration: Int!\n}\n"},"upstreamSchema":{"key":"abcd56f430c569bcd0258d3f30ceabb0131c602a"}},"requestTimeoutSeconds":"10","id":"1","keys":[{"typeName":"Container","selectionSet":"id"}]}],"fieldConfigurations":[{"typeName":"Query","fieldName":"container","argumentsConfiguration":[{"name":"id","sourceType":"FIELD_ARGUMENT"}]}],"graphqlSchema":"schema {\n  query: Query\n}\n\ntype Query {\n  container(id: ID!): Container\n  _noop: Boolean\n}\n\ntype Container {\n  id: ID!\n  items: [SearchResult!]!\n}\n\nunion SearchResult = Article | Image | Video\n\ntype Article {\n  id: ID!\n  title: String!\n}\n\ntype Image {\n  id: ID!\n  url: String\n}\n\ntype Video {\n  id: ID!\n  duration: Int!\n}","stringStorage":{"2af0450b5f382d3fccc224c92327a67a51cac656":"schema {\n  query: Query\n}\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @shareable repeatable on FIELD_DEFINITION | OBJECT\n\ntype Article {\n  id: ID! @shareable\n  title: String! @shareable\n}\n\ntype Container @key(fields: \"id\") {\n  id: ID!\n  items: [SearchResult!]! @shareable\n}\n\ntype Image {\n  id: ID!\n  url: String\n}\n\ntype Query {\n  container(id: ID!): Container\n}\n\nunion SearchResult = Article | Image\n\nscalar openfed__FieldSet","abcd56f430c569bcd0258d3f30ceabb0131c602a":"schema {\n  query: Query\n}\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @shareable repeatable on FIELD_DEFINITION | OBJECT\n\ntype Article {\n  id: ID! @shareable\n  title: String! @shareable\n}\n\ntype Container @key(fields: \"id\") {\n  id: ID!\n  items: [SearchResult!]! @shareable\n}\n\ntype Query {\n  _noop: Boolean\n}\n\nunion SearchResult = Article | Video\n\ntype Video {\n  duration: Int!\n  id: ID!\n}\n\nscalar openfed__FieldSet"}},"version":"00000000-0000-0000-0000-000000000000","subgraphs":[{"id":"0","name":"test1","routingUrl":"http://localhost:4006/graphql"},{"id":"1","name":"products","routingUrl":"http://localhost:4004/graphql"}],"compatibilityVersion":"1:{{$COMPOSITION__VERSION}}"}`

func TestPartialUnionIntersectionOnShareableField(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: partialUnionIntersectionRouterConfigJSONTemplate,
		Subgraphs: testenv.SubgraphsConfig{
			Test1: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))
						require.Equal(t, `query($a: ID!){container(id: $a){items {__typename ... on Article {title} ... on Image {__typename}}}}`, req.Query)
						require.JSONEq(t, `{"a":"container-1"}`, string(req.Variables))

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"container":{"items":[{"__typename":"Article","title":"Planning"},{"__typename":"Image"}]}}}`))
					})
				},
			},
			Products: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						require.Fail(t, "products subgraph should not be queried")
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ container(id: "container-1") { items { __typename ... on Article { title } ... on Image { url } ... on Video { duration } } } }`,
		})

		require.Equal(t, `{"data":{"container":{"items":[{"__typename":"Article","title":"Planning"},{"__typename":"Image","url":null}]}}}`, res.Body)
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Test1.Load())
		require.Equal(t, int64(0), xEnv.SubgraphRequestCount.Products.Load())
	})
}
