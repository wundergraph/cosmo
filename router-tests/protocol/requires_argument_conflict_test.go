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

const requiresArgumentConflictRouterConfigJSONTemplate = `{"engineConfig":{"defaultFlushInterval":"500","datasourceConfigurations":[{"kind":"GRAPHQL","rootNodes":[{"typeName":"Product","fieldNames":["upc","price","weight"]},{"typeName":"Query","fieldNames":["topProduct"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4004/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4004/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Product @key(fields: \"upc\") {\n  upc: String!\n  price(currency: String!): Int @shareable\n  weight: Int @shareable\n}\n\ntype Query {\n  topProduct: Product\n}\n"},"upstreamSchema":{"key":"41a0d6f07e4effcb72e3740b0b3fc261e868a72d"}},"requestTimeoutSeconds":"10","id":"0","keys":[{"typeName":"Product","selectionSet":"upc"}]},{"kind":"GRAPHQL","rootNodes":[{"typeName":"Product","fieldNames":["upc","estimateA","estimateB"],"externalFieldNames":["price","weight"]}],"overrideFieldPathFromAlias":true,"customGraphql":{"fetch":{"url":{"staticVariableContent":"http://localhost:4006/graphql"},"method":"POST","body":{},"baseUrl":{},"path":{}},"subscription":{"enabled":true,"url":{"staticVariableContent":"http://localhost:4006/graphql"},"protocol":"GRAPHQL_SUBSCRIPTION_PROTOCOL_WS","websocketSubprotocol":"GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO"},"federation":{"enabled":true,"serviceSdl":"type Product @key(fields: \"upc\") {\n  upc: String!\n  price(currency: String!): Int @external\n  weight: Int @external\n  estimateA: Int @requires(fields: \"price(currency: \\\"USD\\\") weight\")\n  estimateB: Int @requires(fields: \"price(currency: \\\"EUR\\\") weight\")\n}\n"},"upstreamSchema":{"key":"678a2cb151e96d2f757f3c1141e4b7df2eaa3078"}},"requestTimeoutSeconds":"10","id":"1","keys":[{"typeName":"Product","selectionSet":"upc"}],"requires":[{"typeName":"Product","fieldName":"estimateA","selectionSet":"price(currency: \"USD\") weight"},{"typeName":"Product","fieldName":"estimateB","selectionSet":"price(currency: \"EUR\") weight"}]}],"fieldConfigurations":[{"typeName":"Product","fieldName":"price","argumentsConfiguration":[{"name":"currency","sourceType":"FIELD_ARGUMENT"}]}],"graphqlSchema":"schema {\n  query: Query\n}\n\ntype Product {\n  upc: String!\n  price(currency: String!): Int\n  weight: Int\n  estimateA: Int\n  estimateB: Int\n}\n\ntype Query {\n  topProduct: Product\n}","stringStorage":{"41a0d6f07e4effcb72e3740b0b3fc261e868a72d":"schema {\n  query: Query\n}\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @shareable repeatable on FIELD_DEFINITION | OBJECT\n\ntype Product @key(fields: \"upc\") {\n  price(currency: String!): Int @shareable\n  upc: String!\n  weight: Int @shareable\n}\n\ntype Query {\n  topProduct: Product\n}\n\nscalar openfed__FieldSet","678a2cb151e96d2f757f3c1141e4b7df2eaa3078":"directive @external on FIELD_DEFINITION | OBJECT\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ntype Product @key(fields: \"upc\") {\n  estimateA: Int @requires(fields: \"price(currency: \\\"USD\\\") weight\")\n  estimateB: Int @requires(fields: \"price(currency: \\\"EUR\\\") weight\")\n  price(currency: String!): Int @external\n  upc: String!\n  weight: Int @external\n}\n\nscalar openfed__FieldSet"}},"version":"00000000-0000-0000-0000-000000000000","subgraphs":[{"id":"0","name":"catalog","routingUrl":"http://localhost:4004/graphql"},{"id":"1","name":"inventory","routingUrl":"http://localhost:4006/graphql"}],"compatibilityVersion":"1:{{$COMPOSITION__VERSION}}"}`

func TestRequiresSameProvidingFieldWithDifferentArguments(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: requiresArgumentConflictRouterConfigJSONTemplate,
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))
						require.Equal(t, `query($a: String!, $b: String!){topProduct {price(currency: $a) weight __internal_price: price(currency: $b) __typename upc}}`, req.Query)
						require.JSONEq(t, `{"a":"USD","b":"EUR"}`, string(req.Variables))

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"topProduct":{"__typename":"Product","upc":"top-1","price":100,"__internal_price":200,"weight":10}}}`))
					})
				},
			},
			Test1: testenv.SubgraphConfig{
				Middleware: func(_ http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))

						var variables struct {
							Representations []map[string]any `json:"representations"`
						}
						require.NoError(t, json.Unmarshal(req.Variables, &variables))
						require.Len(t, variables.Representations, 1)

						price := representationInt(variables.Representations[0], "price")
						entity := map[string]any{
							"__typename": "Product",
						}
						switch req.Query {
						case `query($representations: [_Any!]!){_entities(representations: $representations){... on Product {__typename estimateA}}}`:
							require.JSONEq(t, `{"representations":[{"__typename":"Product","price":100,"weight":10,"upc":"top-1"}]}`, string(req.Variables))
							entity["estimateA"] = price
						case `query($representations: [_Any!]!){_entities(representations: $representations){... on Product {__typename estimateB}}}`:
							require.JSONEq(t, `{"representations":[{"__typename":"Product","price":200,"weight":10,"upc":"top-1"}]}`, string(req.Variables))
							entity["estimateB"] = price
						default:
							require.Failf(t, "unexpected inventory request", "query=%s variables=%s", req.Query, string(req.Variables))
						}

						response, err := json.Marshal(map[string]any{
							"data": map[string]any{
								"_entities": []map[string]any{entity},
							},
						})
						require.NoError(t, err)

						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write(response)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ topProduct { estimateA estimateB } }`,
		})

		require.Equal(t, `{"data":{"topProduct":{"estimateA":100,"estimateB":200}}}`, res.Body)
	})
}

func representationInt(representation map[string]any, name string) int {
	switch value := representation[name].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}
