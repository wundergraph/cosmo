package integration

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestRouterPlugin(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		RouterOptions: []core.Option{
			core.WithPlugins(config.PluginsConfiguration{
				Path: "../router/plugins",
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `
				query {
					projects {
						id
						name
					}
				}
			`,
		})

		require.Equal(t, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Redesign"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)
	})
}
