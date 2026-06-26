package integration

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

//go:embed testdata/multihop_compound_key_config.json
var multiHopCompoundKeyRouterConfigJSONTemplate string

func TestMultiHopCompoundKeyEntityRoute(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: multiHopCompoundKeyRouterConfigJSONTemplate,
		NoRetryClient:            true,
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: multiHopProductsHandler(t),
			},
			Products: testenv.SubgraphConfig{
				Middleware: multiHopListHandler(t),
			},
			Test1: testenv.SubgraphConfig{
				Middleware: multiHopLinkHandler(t),
			},
			Availability: testenv.SubgraphConfig{
				Middleware: multiHopPriceHandler(t),
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{
				topProducts {
					products {
						id
						pid
						price {
							price
						}
						category {
							mainProduct {
								id
							}
							id
							tag
						}
					}
					selected {
						id
					}
					first {
						id
					}
				}
			}`,
		})

		require.Equal(t, `{"data":{"topProducts":{"products":[{"id":"1","pid":"p1","price":{"price":100},"category":{"mainProduct":{"id":"1"},"id":"c1","tag":"t1"}},{"id":"2","pid":"p2","price":{"price":200},"category":{"mainProduct":{"id":"2"},"id":"c2","tag":"t2"}}],"selected":{"id":"2"},"first":{"id":"1"}}}}`, res.Body)
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Employees.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Test1.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Products.Load())
		require.Equal(t, int64(1), xEnv.SubgraphRequestCount.Availability.Load())
	})
}

func multiHopProductsHandler(t *testing.T) func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := readGraphQLRequest(t, r)
			require.Equal(t, `{topProducts {products {id category {mainProduct {id} id tag} __typename} __typename}}`, req.Query)
			require.Empty(t, req.Variables)

			writeGraphQLResponse(t, w, `{"data":{"topProducts":{"products":[{"id":"1","__typename":"Product","category":{"id":"c1","tag":"t1","mainProduct":{"id":"1","__typename":"Product"},"__typename":"Category"}},{"id":"2","__typename":"Product","category":{"id":"c2","tag":"t2","mainProduct":{"id":"2","__typename":"Product"},"__typename":"Category"}}],"__typename":"ProductList"}}}`)
		})
	}
}

func multiHopLinkHandler(t *testing.T) func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := readGraphQLRequest(t, r)
			require.Equal(t, `query($representations: [_Any!]!){_entities(representations: $representations){... on Product {__typename pid}}}`, req.Query)
			require.JSONEq(t, `{"representations":[{"__typename":"Product","id":"1"},{"__typename":"Product","id":"2"}]}`, string(req.Variables))

			representations := graphQLRepresentations(t, req)
			entities := make([]map[string]string, 0, len(representations))
			for _, representation := range representations {
				require.Equal(t, "Product", representation["__typename"])
				id, _ := representation["id"].(string)
				require.NotEmpty(t, id)
				entities = append(entities, map[string]string{
					"__typename": "Product",
					"id":         id,
					"pid":        "p" + id,
				})
			}

			writeGraphQLData(t, w, map[string]any{"_entities": entities})
		})
	}
}

func multiHopListHandler(t *testing.T) func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := readGraphQLRequest(t, r)
			require.Equal(t, `query($representations: [_Any!]!){_entities(representations: $representations){... on ProductList {__typename selected {id} first {id}}}}`, req.Query)
			require.JSONEq(t, `{"representations":[{"__typename":"ProductList","products":[{"id":"1","pid":"p1"},{"id":"2","pid":"p2"}]}]}`, string(req.Variables))

			representations := graphQLRepresentations(t, req)
			entities := make([]map[string]any, 0, len(representations))
			for _, representation := range representations {
				require.Equal(t, "ProductList", representation["__typename"])
				products, ok := representation["products"].([]any)
				require.True(t, ok)
				require.Len(t, products, 2)
				require.Equal(t, "p1", products[0].(map[string]any)["pid"])
				require.Equal(t, "p2", products[1].(map[string]any)["pid"])

				entities = append(entities, map[string]any{
					"__typename": "ProductList",
					"products": []map[string]string{
						{"__typename": "Product", "id": "1", "pid": "p1"},
						{"__typename": "Product", "id": "2", "pid": "p2"},
					},
					"first":    map[string]string{"__typename": "Product", "id": "1"},
					"selected": map[string]string{"__typename": "Product", "id": "2"},
				})
			}

			writeGraphQLData(t, w, map[string]any{"_entities": entities})
		})
	}
}

func multiHopPriceHandler(t *testing.T) func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			req := readGraphQLRequest(t, r)
			require.Equal(t, `query($representations: [_Any!]!){_entities(representations: $representations){... on Product {__typename price {price}}}}`, req.Query)
			require.JSONEq(t, `{"representations":[{"__typename":"Product","category":{"id":"c1","tag":"t1"},"id":"1","pid":"p1"},{"__typename":"Product","category":{"id":"c2","tag":"t2"},"id":"2","pid":"p2"}]}`, string(req.Variables))

			representations := graphQLRepresentations(t, req)
			entities := make([]map[string]any, 0, len(representations))
			for _, representation := range representations {
				require.Equal(t, "Product", representation["__typename"])
				id, _ := representation["id"].(string)
				pid, _ := representation["pid"].(string)
				category, ok := representation["category"].(map[string]any)
				require.True(t, ok)
				require.Equal(t, "p"+id, pid)
				require.Equal(t, "c"+id, category["id"])
				require.Equal(t, "t"+id, category["tag"])

				price := 100
				if id == "2" {
					price = 200
				}
				entities = append(entities, map[string]any{
					"__typename": "Product",
					"id":         id,
					"pid":        pid,
					"price":      map[string]any{"price": price},
				})
			}

			writeGraphQLData(t, w, map[string]any{"_entities": entities})
		})
	}
}

func graphQLRepresentations(t *testing.T, req core.GraphQLRequest) []map[string]any {
	t.Helper()

	var variables struct {
		Representations []map[string]any `json:"representations"`
	}
	require.NoError(t, json.Unmarshal(req.Variables, &variables))
	require.NotEmpty(t, variables.Representations)
	return variables.Representations
}

func writeGraphQLData(t *testing.T, w http.ResponseWriter, data any) {
	t.Helper()

	body, err := json.Marshal(map[string]any{"data": data})
	require.NoError(t, err)
	writeGraphQLResponse(t, w, string(body))
}

func writeGraphQLResponse(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()

	require.True(t, strings.HasPrefix(body, `{"data":`), "unexpected GraphQL response body: %s", body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write([]byte(body))
	require.NoError(t, err)
}
