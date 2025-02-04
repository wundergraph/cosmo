package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"testing"
)

func TestSafelist(t *testing.T) {
	t.Parallel()

	t.Run("safelist works with persisted query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.SafelistOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n employees {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("safelist rejects persisted query with different spacing", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.SafelistOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				Query:         "query Employees {\n employees   {\n id\n }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		})
	})

	t.Run("safelist blocks non persisted query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: false,
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.Safelist = config.SafelistOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"Employees"`),
				Header:        header,
				//Query:         `query Employees { employees { id details { forename } } }`,
				Query: "query Employees {\n employees {\n id\n details {\n forename\n} \n}\n}",
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		})
	})
}
