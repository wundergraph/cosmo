package integration

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"strings"
	"testing"
)

func TestHeaderSet(t *testing.T) {
	const (
		customHeader = "X-Custom-Header"
		employeeVal  = "employee-value"
		hobbyVal     = "hobby-value"
	)

	const queryEmployeeWithHobby = `{
	  employee(id: 1) {
		id
		hobbies {
		  ... on Gaming {
			name
		  }
		}
	  }
	}`

	t.Run("RequestSet", func(t *testing.T) {
		getRule := func(name, val string) *config.RequestHeaderRule {
			rule := &config.RequestHeaderRule{
				Operation: config.HeaderRuleOperationSet,
				Name:      name,
				Value:     val,
			}
			return rule
		}

		global := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							getRule(name, defaultVal),
						},
					},
				}),
			}
		}

		t.Run("global request rule sets header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(customHeader, employeeVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: http.Header{},
					Query:  fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
				})
				require.Equal(t, fmt.Sprintf(`{"data":{"headerValue":"%s"}}`, employeeVal), res.Body)
			})
		})
	})

	t.Run("ResponseSet", func(t *testing.T) {
		getRule := func(name, val string) *config.ResponseHeaderRule {
			rule := &config.ResponseHeaderRule{
				Operation: config.HeaderRuleOperationSet,
				Name:      name,
				Value:     val,
			}
			return rule
		}

		global := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							getRule(name, defaultVal),
						},
					},
				}),
			}
		}

		partial := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Subgraphs: map[string]*config.GlobalHeaderRule{
						"employees": {
							Response: []*config.ResponseHeaderRule{
								getRule(name, defaultVal),
							},
						},
					},
				}),
			}
		}

		t.Run("no set", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "", ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("global set works", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(customHeader, hobbyVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, hobbyVal, ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("subgraph set works", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(customHeader, employeeVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})
	})
}
