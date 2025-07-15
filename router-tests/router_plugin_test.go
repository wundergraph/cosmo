package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestRouterPlugin(t *testing.T) {
	t.Parallel()

	t.Run("Should successfully start the router when plugins are enabled but no plugins are in the execution config", func(t *testing.T) {
		t.Parallel()
		err := testenv.RunWithError(t, &testenv.Config{
			Plugins: testenv.PluginConfig{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {})

		require.NoError(t, err)
	})

	t.Run("Should fail on startup when no plugins found at a path", func(t *testing.T) {
		t.Parallel()
		testenv.FailsOnStartup(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			Plugins: testenv.PluginConfig{
				Enabled: true,
				Path:    "./non-existing-path",
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "failed to start plugin process")
		})
	})

	t.Run("Should not be able to call plugin if it is not enabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			Plugins: testenv.PluginConfig{
				Enabled: false,
				Path:    "../router/plugins",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { project(id: 1) { id } }`,
			})

			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'projects'.","extensions":{"errors":[{"message":"gRPC datasource needs to be enabled to be used","extensions":{"code":"Internal"}}]}}],"data":{"project":null}}`, response.Body)
		})
	})

	t.Run("Should restart plugin if it exits", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.ErrorLevel,
			},
			Plugins: testenv.PluginConfig{
				Enabled: true,
				Path:    "../router/plugins",
			},
		},
			func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { killService }`, // this will kill the plugin
				})

				require.EventuallyWithT(t, func(c *assert.CollectT) {
					logMessages := xEnv.Observer().All()
					require.Greater(t, len(logMessages), 0)
					require.Equal(t, "plugin process exited", logMessages[0].Message)
				}, 5*time.Second, 1*time.Second)

				require.EventuallyWithT(t, func(c *assert.CollectT) {
					// the service should restart the plugin automatically and the request should succeed
					response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})

					require.Equal(c, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Redesign"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)
				}, 20*time.Second, 10*time.Second)
			},
		)
	})
}

func TestRouterPluginRequests(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		query    string
		expected string
	}{
		{
			name:     "query projects simple",
			query:    `query { projects { id name } }`,
			expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Redesign"},{"id":"7","name":"Data Lake Implementation"}]}}`,
		},
		{
			name:     "query projects with argument",
			query:    `query { project(id: 1) { id name description status }}`,
			expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"}}}`,
		},
		{
			name:     "query project with nested field",
			query:    `query { project(id: 1) { description teamMembers { details { forename surname }}}}`,
			expected: `{"data":{"project":{"description":"Migrate legacy systems to cloud-native architecture","teamMembers":[{"details":{"forename":"Jens","surname":"Neuse"}},{"details":{"forename":"Dustin","surname":"Deus"}},{"details":{"forename":"Stefan","surname":"Avram"}}]}}}`,
		},
		{
			name:     "query project list with nested field",
			query:    `query { projects { id name milestoneIds teamMembers { id notes currentMood } } }`,
			expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul","milestoneIds":["1","2","3"],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"}]},{"id":"2","name":"Microservices Revolution","milestoneIds":["4","5","6"],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"},{"id":8,"notes":"Nithin notes resolved by products","currentMood":"HAPPY"}]},{"id":"3","name":"AI-Powered Analytics","milestoneIds":[],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"}]},{"id":"4","name":"DevOps Transformation","milestoneIds":[],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":4,"notes":"Björn notes resolved by products","currentMood":"HAPPY"}]},{"id":"5","name":"Security Overhaul","milestoneIds":[],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":10,"notes":"Eelco notes resolved by products","currentMood":"HAPPY"}]},{"id":"6","name":"Mobile App Redesign","milestoneIds":["7","8"],"teamMembers":[{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"},{"id":11,"notes":"Alexandra notes resolved by products","currentMood":"HAPPY"}]},{"id":"7","name":"Data Lake Implementation","milestoneIds":["9","10"],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":12,"notes":"David notes resolved by products","currentMood":"HAPPY"}]}]}}`,
		},
		{
			name:     "query employee list with nested field",
			query:    `query  {employees {id details { forename surname } projects { id name description status }}}`,
			expected: `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"},{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"6","name":"Mobile App Redesign","description":"Modernize mobile applications with Flutter","status":"COMPLETED"}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"projects":[{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"projects":[{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"projects":[{"id":"6","name":"Mobile App Redesign","description":"Modernize mobile applications with Flutter","status":"COMPLETED"}]},{"id":12,"details":{"forename":"David","surname":"Stutt"},"projects":[{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]}]}}`,
		},
		{
			name:     "query project resources with inline fragment",
			query:    `query { projectResources(projectId: "1") { __typename ... on Milestone { __typename id name }}}`,
			expected: `{"data":{"projectResources":[{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Product"},{"__typename":"Milestone","id":"1","name":"Infrastructure Assessment"},{"__typename":"Milestone","id":"2","name":"Cloud Environment Setup"},{"__typename":"Milestone","id":"3","name":"Application Migration"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"}]}}`,
		},
		{
			name:     "query project resources with multiple inline fragments",
			query:    `query { projectResources(projectId: "1") { ... on Milestone { __typename id name } ... on Task { __typename projectId name description }} }`,
			expected: `{"data":{"projectResources":[{},{},{},{},{"__typename":"Milestone","id":"1","name":"Infrastructure Assessment"},{"__typename":"Milestone","id":"2","name":"Cloud Environment Setup"},{"__typename":"Milestone","id":"3","name":"Application Migration"},{"__typename":"Task","projectId":"1","name":"Current Infrastructure Audit","description":"Document existing servers, databases, and applications"},{"__typename":"Task","projectId":"1","name":"Cloud Provider Selection","description":"Evaluate AWS, Azure, and GCP options"},{"__typename":"Task","projectId":"1","name":"Network Setup","description":"Configure VPCs, subnets, and security groups"},{"__typename":"Task","projectId":"1","name":"Database Migration","description":"Migrate databases to cloud-managed services"}]}}`,
		},
		{
			name:     "query project resources with inline fragment and aliases",
			query:    `query { projectResources(projectId: 3){ ... on Task {  name oldID: projectId newID: projectId }}}`,
			expected: `{"data":{"projectResources":[{},{},{},{"name":"Machine Learning Model Research","oldID":"3","newID":"3"},{"name":"Data Pipeline Design","oldID":"3","newID":"3"}]}}`,
		},
	}
	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		Plugins: testenv.PluginConfig{
			Enabled: true,
			Path:    "../router/plugins",
		},
	},
		func(t *testing.T, xEnv *testenv.Environment) {
			for _, test := range tests {
				t.Run(test.name, func(t *testing.T) {
					t.Parallel()
					response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: test.query,
					})

					require.Equal(t, test.expected, response.Body)
				})
			}
		})
}
