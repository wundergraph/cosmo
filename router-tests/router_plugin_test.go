package integration

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/otel"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
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
			response1 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { project(id: 1) { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'projects'.","extensions":{"errors":[{"message":"gRPC datasource needs to be enabled to be used","extensions":{"code":"Internal"}}]}}],"data":{"project":null}}`, response1.Body)

			response2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { course(id: 1) { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'courses'.","extensions":{"errors":[{"message":"gRPC datasource needs to be enabled to be used","extensions":{"code":"Internal"}}]}}],"data":{"course":null}}`, response2.Body)
		})
	})

	t.Run("Should restart plugin if it exits for projects", func(t *testing.T) {
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
					require.True(c, slices.ContainsFunc(logMessages, func(msg observer.LoggedEntry) bool {
						return strings.Contains(msg.Message, "plugin process exited")
					}), "expected to find 'plugin process exited' message in logs")
				}, 5*time.Second, 1*time.Second)

				require.EventuallyWithT(t, func(c *assert.CollectT) {
					// the service should restart the plugin automatically and the request should succeed
					response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})

					require.Equal(c, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)
				}, 20*time.Second, 2*time.Second)
			},
		)
	})

	t.Run("Should restart plugin if it exits for courses", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			Plugins: testenv.PluginConfig{
				Enabled: true,
				Path:    "../router/plugins",
			},
		},
			func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { killCoursesService }`, // this will kill the plugin
				})

				require.EventuallyWithT(t, func(c *assert.CollectT) {
					logMessages := xEnv.Observer().All()
					require.True(c, slices.ContainsFunc(logMessages, func(msg observer.LoggedEntry) bool {
						return strings.Contains(msg.Message, "plugin process exited")
					}), "expected to find 'plugin process exited' message in logs")
				}, 20*time.Second, 500*time.Millisecond)

				require.EventuallyWithT(t, func(c *assert.CollectT) {
					// the service should restart the plugin automatically and the request should succeed
					response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { courses { id } }`,
					})

					require.Equal(c, `{"data":{"courses":[{"id":"1"},{"id":"2"},{"id":"3"}]}}`, response.Body)
				}, 30*time.Second, 200*time.Millisecond)
			},
		)
	})
}

func TestVerifyTelemetryForRouterPluginRequests(t *testing.T) {
	t.Parallel()

	t.Run("query projects simple", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t,
			&testenv.Config{
				TraceExporter:            exporter,
				RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
				Plugins: testenv.PluginConfig{
					Enabled: true,
					Path:    "../router/plugins",
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				queryName := "query sample"
				response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: fmt.Sprintf(`%s { a:projects { id name }, e:projects { id name } }`, queryName),
				})

				expected := `{"data":{"a":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}],"e":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`
				require.Equal(t, expected, response.Body)

				snapshots := exporter.GetSpans().Snapshots()
				require.Len(t, snapshots, 10)

				queryNameInstances := 0
				for _, sn := range snapshots {
					if sn.Name() == queryName {
						queryNameInstances++
					}
				}

				require.Equal(t, queryNameInstances, 3)
			})
	})

	t.Run("verify each invocation having its span", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t,
			&testenv.Config{
				TraceExporter:            exporter,
				RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
				Plugins: testenv.PluginConfig{
					Enabled: true,
					Path:    "../router/plugins",
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query projects { a: projects { id name } b:project(id: 2) { id } }`,
				})

				expected := `{"data":{"a":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}],"b":{"id":"2"}}}`
				require.Equal(t, expected, response.Body)

				snapshots := exporter.GetSpans().Snapshots()
				require.Len(t, snapshots, 10)

				span1 := snapshots[5]
				require.Equal(t, "query projects", span1.Name())
				require.Contains(t, span1.Attributes(), otel.WgOperationProtocol.String("grpc"))
				require.Contains(t, span1.Attributes(), otel.WgOperationType.String("query"))
				require.Contains(t, span1.Attributes(), otel.WgOperationName.String("projects"))
				require.Len(t, span1.Attributes(), 11)

				span2 := snapshots[6]
				require.Equal(t, "query projects", span2.Name())
				require.Contains(t, span2.Attributes(), otel.WgOperationProtocol.String("grpc"))
				require.Contains(t, span2.Attributes(), otel.WgOperationType.String("query"))
				require.Contains(t, span2.Attributes(), otel.WgOperationName.String("projects"))
				require.Len(t, span2.Attributes(), 11)
			})
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
			expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`,
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
			expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul","milestoneIds":["1","2","3"],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"}]},{"id":"2","name":"Microservices Revolution","milestoneIds":["4","5","6"],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":4,"notes":"Björn notes resolved by products","currentMood":"HAPPY"},{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"},{"id":8,"notes":"Nithin notes resolved by products","currentMood":"HAPPY"}]},{"id":"3","name":"AI-Powered Analytics","milestoneIds":[],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":6,"notes":null,"currentMood":"HAPPY"}]},{"id":"4","name":"DevOps Transformation","milestoneIds":[],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":9,"notes":null,"currentMood":"HAPPY"}]},{"id":"5","name":"Security Overhaul","milestoneIds":[],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":9,"notes":null,"currentMood":"HAPPY"},{"id":10,"notes":"Eelco notes resolved by products","currentMood":"HAPPY"}]},{"id":"6","name":"Mobile App Development","milestoneIds":["7","8"],"teamMembers":[{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"},{"id":11,"notes":"Alexandra notes resolved by products","currentMood":"HAPPY"}]},{"id":"7","name":"Data Lake Implementation","milestoneIds":["9","10"],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":12,"notes":"David notes resolved by products","currentMood":"HAPPY"}]}]}}`,
		},
		{
			name:     "query employee list with nested field",
			query:    `query  {employees {id details { forename surname } projects { id name description status }}}`,
			expected: `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"},{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"6","name":"Mobile App Development","description":"Build native mobile applications for iOS and Android","status":"ACTIVE"}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"projects":[{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"projects":[{"id":"6","name":"Mobile App Development","description":"Build native mobile applications for iOS and Android","status":"ACTIVE"}]},{"id":12,"details":{"forename":"David","surname":"Stutt"},"projects":[{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]}]}}`,
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
		{
			name:     "query project with nullable list fields",
			query:    `query { project(id: "1") { id name tags alternativeProjects { id name } dependencies { id name } } }`,
			expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","tags":["cloud","migration","priority"],"alternativeProjects":[{"id":"4","name":"DevOps Transformation"}],"dependencies":[]}}}`,
		},
		{
			name:     "query project with null tags",
			query:    `query { project(id: "3") { id name tags } }`,
			expected: `{"data":{"project":{"id":"3","name":"AI-Powered Analytics","tags":null}}}`,
		},
		{
			name:     "query tasks by priority nested lists",
			query:    `query { tasksByPriority(projectId: "1") { __typename priority } }`,
			expected: `{"data":{"tasksByPriority":[[],[{"__typename":"Task","priority":"MEDIUM"}],[{"__typename":"Task","priority":"HIGH"},{"__typename":"Task","priority":"HIGH"},{"__typename":"Task","priority":"HIGH"}],[],[],null]}}`,
		},
		{
			name:     "query project tags simple list",
			query:    `query { projectTags }`,
			expected: `{"data":{"projectTags":["cloud","migration","priority","microservices","architecture","devops","ci-cd","infrastructure","security","zero-trust","mobile","ios","android","data","analytics","lake","","nullable-tag"]}}`,
		},
		{
			name:     "query archived projects non nullable list with empty item",
			query:    `query { archivedProjects { id name } }`,
			expected: `{"data":{"archivedProjects":[{"id":"","name":""}]}}`,
		},
		{
			name:     "query employee with list fields",
			query:    `query { employees { id skills certifications } }`,
			expected: `{"data":{"employees":[{"id":1,"skills":["AWS","Kubernetes","Infrastructure"],"certifications":["AWS Solutions Architect","CKA"]},{"id":2,"skills":null,"certifications":["GCP Professional Cloud Architect"]},{"id":3,"skills":["Networking","Security","Monitoring"],"certifications":["CISSP","CCNA"]},{"id":4,"skills":["Java","Spring","Microservices"],"certifications":["Oracle Certified Professional Java SE"]},{"id":5,"skills":["Python","Machine Learning","Data Science"],"certifications":["Google Professional Data Engineer"]},{"id":7,"skills":["System Architecture","Distributed Systems"],"certifications":["TOGAF 9 Certified"]},{"id":8,"skills":["Node.js","GraphQL","REST APIs"],"certifications":["MongoDB Certified Developer"]},{"id":10,"skills":["Backend","Go","Docker"],"certifications":["HashiCorp Certified Terraform Associate"]},{"id":11,"skills":["Frontend","React","TypeScript"],"certifications":null},{"id":12,"skills":["Backend","Go","Docker"],"certifications":["HashiCorp Certified Terraform Associate"]}]}}`,
		},
		{
			name:     "query employee project history nested lists",
			query:    `query { employees { id projectHistory { id name } } }`,
			expected: `{"data":{"employees":[{"id":1,"projectHistory":[[{"id":"1","name":"Cloud Migration Overhaul"}],[{"id":"4","name":"DevOps Transformation"}]]},{"id":2,"projectHistory":[[{"id":"1","name":"Cloud Migration Overhaul"}],[{"id":"2","name":"Microservices Revolution"}],[{"id":"5","name":"Security Overhaul"}]]},{"id":3,"projectHistory":[]},{"id":4,"projectHistory":[]},{"id":5,"projectHistory":[[{"id":"3","name":"AI-Powered Analytics"}],[{"id":"7","name":"Data Lake Implementation"}]]},{"id":7,"projectHistory":[[{"id":"2","name":"Microservices Revolution"}]]},{"id":8,"projectHistory":[[{"id":"2","name":"Microservices Revolution"}]]},{"id":10,"projectHistory":[]},{"id":11,"projectHistory":[[{"id":"6","name":"Mobile App Development"}]]},{"id":12,"projectHistory":[[{"id":"7","name":"Data Lake Implementation"}]]}]}}`,
		},
		{
			name:     "query tasks with list fields",
			query:    `query { tasks(projectId: "1") { id name labels attachmentUrls reviewerIds } }`,
			expected: `{"data":{"tasks":[{"id":"1","name":"Current Infrastructure Audit","labels":["audit","infrastructure","high-priority"],"attachmentUrls":["https://docs.company.com/audit-report.pdf","https://drive.company.com/infrastructure-map"],"reviewerIds":[2,3]},{"id":"2","name":"Cloud Provider Selection","labels":null,"attachmentUrls":["https://docs.company.com/cloud-comparison.xlsx"],"reviewerIds":[1,4]},{"id":"3","name":"Network Setup","labels":["networking","cloud","security"],"attachmentUrls":[],"reviewerIds":[2]},{"id":"14","name":"Database Migration","labels":null,"attachmentUrls":[],"reviewerIds":null}]}}`,
		},
		{
			name:     "query milestones with list fields",
			query:    `query { milestones(projectId: "1") { id name dependencies { id name } reviewers { id } } }`,
			expected: `{"data":{"milestones":[{"id":"1","name":"Infrastructure Assessment","dependencies":[],"reviewers":[{"id":1},{"id":2}]},{"id":"2","name":"Cloud Environment Setup","dependencies":[{"id":"1","name":"Infrastructure Assessment"},{"id":"","name":""}],"reviewers":[{"id":1},{"id":2}]},{"id":"3","name":"Application Migration","dependencies":[{"id":"2","name":"Cloud Environment Setup"},{"id":"","name":""}],"reviewers":[{"id":1},{"id":2}]}]}}`,
		},
		{
			name:     "query project with milestone groups nested lists",
			query:    `query { project(id: "1") { id milestoneGroups { id name status } } }`,
			expected: `{"data":{"project":{"id":"1","milestoneGroups":[[{"id":"3","name":"Application Migration","status":"PENDING"}],[{"id":"2","name":"Cloud Environment Setup","status":"IN_PROGRESS"}],[{"id":"1","name":"Infrastructure Assessment","status":"COMPLETED"}],[]]}}}`,
		},
		{
			name:     "query project with tasks by phase nested lists",
			query:    `query { project(id: "1") { id tasksByPhase { id name status } } }`,
			expected: `{"data":{"project":{"id":"1","tasksByPhase":[[{"id":"14","name":"Database Migration","status":"TODO"}],[{"id":"3","name":"Network Setup","status":"IN_PROGRESS"}],[],[{"id":"1","name":"Current Infrastructure Audit","status":"COMPLETED"},{"id":"2","name":"Cloud Provider Selection","status":"COMPLETED"}],[],null]}}}`,
		},
		{
			name:     "query resource matrix nested lists",
			query:    `query { resourceMatrix(projectId: "1") { __typename } }`,
			expected: `{"data":{"resourceMatrix":[[{"__typename":"Milestone"},{"__typename":"Milestone"},{"__typename":"Milestone"}],[{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"}],[{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Employee"}],[{"__typename":"Product"}]]}}`,
		},
		{
			name:     "query project priority matrix triple nested lists",
			query:    `query { project(id: "1") { id priorityMatrix { id name priority } } }`,
			expected: `{"data":{"project":{"id":"1","priorityMatrix":[[],[[{"id":"3","name":"Network Setup","priority":"MEDIUM"}]],[[{"id":"1","name":"Current Infrastructure Audit","priority":"HIGH"}],[{"id":"2","name":"Cloud Provider Selection","priority":"HIGH"}],[{"id":"14","name":"Database Migration","priority":"HIGH"}]],[]]}}}`,
		},
		{
			name:     "query project subtasks for empty and nullable lists",
			query:    `query { projects { id tasks { id subtasks { id name } } } }`,
			expected: `{"data":{"projects":[{"id":"1","tasks":[{"id":"1","subtasks":[{"id":"1a","name":"Server Inventory"},{"id":"1b","name":"Database Inventory"},{"id":"","name":""}]},{"id":"2","subtasks":null},{"id":"3","subtasks":[{"id":"3a","name":"VPC Configuration"},{"id":"3b","name":"Security Groups"},{"id":"","name":""}]},{"id":"14","subtasks":[]}]},{"id":"2","tasks":[{"id":"4","subtasks":[]},{"id":"5","subtasks":[]}]},{"id":"3","tasks":[{"id":"6","subtasks":null},{"id":"7","subtasks":[]}]},{"id":"4","tasks":[{"id":"8","subtasks":[]}]},{"id":"5","tasks":[{"id":"9","subtasks":[]}]},{"id":"6","tasks":[{"id":"10","subtasks":null},{"id":"11","subtasks":[]}]},{"id":"7","tasks":[{"id":"12","subtasks":[]},{"id":"13","subtasks":[]}]}]}}`,
		},
		{
			name:     "query project with nullable fields and aliases",
			query:    `query { project(id: "1") { id name myDescription: description myStartDate: startDate myEndDate: endDate } }`,
			expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","myDescription":"Migrate legacy systems to cloud-native architecture","myStartDate":"2021-01-01","myEndDate":"2025-08-20"}}}`,
		},
		{
			name:     "query project with field resolver",
			query:    `query { project(id:1) { filteredTasks(limit: 3) { name status }}}`,
			expected: `{"data":{"project":{"filteredTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"},{"name":"Cloud Provider Selection","status":"COMPLETED"},{"name":"Network Setup","status":"IN_PROGRESS"}]}}}`,
		},
		{
			name:     "query projects with multiple field resolvers",
			query:    `query { projects { name status completionRate(includeSubtasks: true) filteredTasks(limit: 3) { name status } } }`,
			expected: `{"data":{"projects":[{"name":"Cloud Migration Overhaul","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"},{"name":"Cloud Provider Selection","status":"COMPLETED"},{"name":"Network Setup","status":"IN_PROGRESS"}]},{"name":"Microservices Revolution","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Domain Model Analysis","status":"COMPLETED"},{"name":"API Gateway Configuration","status":"IN_PROGRESS"}]},{"name":"AI-Powered Analytics","status":"ACTIVE","completionRate":0,"filteredTasks":[{"name":"Machine Learning Model Research","status":"IN_PROGRESS"},{"name":"Data Pipeline Design","status":"TODO"}]},{"name":"DevOps Transformation","status":"PLANNING","completionRate":0,"filteredTasks":[{"name":"CI/CD Pipeline Setup","status":"TODO"}]},{"name":"Security Overhaul","status":"ON_HOLD","completionRate":0,"filteredTasks":[{"name":"Security Assessment","status":"BLOCKED"}]},{"name":"Mobile App Development","status":"ACTIVE","completionRate":100,"filteredTasks":[{"name":"User Experience Testing","status":"COMPLETED"},{"name":"Flutter App Development","status":"COMPLETED"}]},{"name":"Data Lake Implementation","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Data Schema Design","status":"COMPLETED"},{"name":"Apache Spark Integration","status":"IN_PROGRESS"}]}]}}`,
		},
		{
			name:     "query employee current workload",
			query:    "query { employees { assignedTasks { name status } completedTasks { name status } currentWorkload(includeCompleted: false) } }",
			expected: `{"data":{"employees":[{"assignedTasks":[{"name":"CI/CD Pipeline Setup","status":"TODO"},{"name":"Database Migration","status":"TODO"}],"completedTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"}],"currentWorkload":2},{"assignedTasks":[{"name":"Security Assessment","status":"BLOCKED"}],"completedTasks":[{"name":"Cloud Provider Selection","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[{"name":"Network Setup","status":"IN_PROGRESS"}],"completedTasks":[{"name":"User Experience Testing","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[],"completedTasks":[],"currentWorkload":0},{"assignedTasks":[],"completedTasks":[{"name":"Data Schema Design","status":"COMPLETED"}],"currentWorkload":0},{"assignedTasks":[{"name":"Data Pipeline Design","status":"TODO"}],"completedTasks":[{"name":"Domain Model Analysis","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[{"name":"API Gateway Configuration","status":"IN_PROGRESS"}],"completedTasks":[],"currentWorkload":1},{"assignedTasks":[],"completedTasks":[],"currentWorkload":0},{"assignedTasks":[],"completedTasks":[{"name":"Flutter App Development","status":"COMPLETED"}],"currentWorkload":0},{"assignedTasks":[{"name":"Apache Spark Integration","status":"IN_PROGRESS"}],"completedTasks":[],"currentWorkload":1}]}}`,
		},
		{
			name:     "query courses simple",
			query:    `query { courses { id title description } }`,
			expected: `{"data":{"courses":[{"id":"1","title":"Introduction to TypeScript","description":"Learn the basics of TypeScript"},{"id":"2","title":"Advanced GraphQL","description":"Master GraphQL federation"},{"id":"3","title":"Go Programming","description":"Build services with Go"}]}}`,
		},
		{
			name:     "query courses with argument",
			query:    `query { course(id: 1) { id title description } }`,
			expected: `{"data":{"course":{"id":"1","title":"Introduction to TypeScript","description":"Learn the basics of TypeScript"}}}`,
		},
		{
			name:     "query employees teaching a course",
			query:    `query { employee(id: 1) { details { forename surname } taughtCourses { id title description } } }`,
			expected: `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"},"taughtCourses":[{"id":"1","title":"Introduction to TypeScript","description":"Learn the basics of TypeScript"},{"id":"2","title":"Advanced GraphQL","description":"Master GraphQL federation"}]}}}`,
		},
		{
			name:     "query top priority item",
			query:    `query { project(id:1) { topPriorityItem(category: "milestone") { __typename ... on Milestone { name reviewers { id details{ forename surname } } } } } }`,
			expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Milestone","name":"Application Migration","reviewers":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}]}}}}`,
		},
		{
			name:     "query top priority item for task category",
			query:    `query { project(id:2) { topPriorityItem(category: "task") { __typename ... on Task { name priority assigneeId } } } }`,
			expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"API Gateway Configuration","priority":"HIGH","assigneeId":8}}}}`,
		},
		{
			name:     "query top priority item for project with only completed tasks",
			query:    `query { project(id:6) { topPriorityItem { __typename ... on Milestone { name status } } } }`,
			expected: `{"data":{"project":{"topPriorityItem":null}}}`,
		},
		{
			name:     "query critical deadline with large window to ensure deterministic results",
			query:    `query { project(id:1) { criticalDeadline(withinDays: 10000) { __typename ... on Milestone { name endDate status } ... on Project { name endDate } } } }`,
			expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","name":"Application Migration","endDate":"2025-08-20","status":"PENDING"}}}}`,
		},
		{
			name:     "query critical deadline for project 2",
			query:    `query { project(id:2) { criticalDeadline(withinDays: 10000) { __typename ... on Milestone { id name status } } } }`,
			expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","id":"6","name":"Service Deployment","status":"PENDING"}}}}`,
		},
		{
			name:     "query critical deadline returns project if no milestones",
			query:    `query { project(id:3) { criticalDeadline(withinDays: 10000) { __typename ... on Project { id name status endDate } } } }`,
			expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Project","id":"3","name":"AI-Powered Analytics","status":"ACTIVE","endDate":"2025-08-20"}}}}`,
		},
		{
			name:     "query both field resolvers together",
			query:    `query { project(id:1) { id name topPriorityItem(category: "task") { __typename } completionRate(includeSubtasks: false) } }`,
			expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","topPriorityItem":{"__typename":"Task"},"completionRate":50}}}`,
		},
		{
			name:     "query multiple projects with field resolvers",
			query:    `query { projects { id topPriorityItem(category: "task") { __typename } } }`,
			expected: `{"data":{"projects":[{"id":"1","topPriorityItem":{"__typename":"Task"}},{"id":"2","topPriorityItem":{"__typename":"Task"}},{"id":"3","topPriorityItem":{"__typename":"Task"}},{"id":"4","topPriorityItem":{"__typename":"Task"}},{"id":"5","topPriorityItem":{"__typename":"Task"}},{"id":"6","topPriorityItem":null},{"id":"7","topPriorityItem":{"__typename":"Task"}}]}}`,
		},
		{
			name:     "query critical deadline with nested inline fragments on interface",
			query:    `query { project(id:7) { criticalDeadline(withinDays: 10000) { __typename ... on Timestamped { startDate endDate ... on Milestone { name projectId } ... on Project { description } } } } }`,
			expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","startDate":"2023-07-01","endDate":"2024-12-31","name":"Data Ingestion Pipeline","projectId":"7"}}}}`,
		},
		{
			name:     "query top priority item with union inline fragments",
			query:    `query { project(id:1) { topPriorityItem(category: "") { __typename ... on Project { name projectStatus: status } ... on Milestone { name milstoneStatus: status } ... on Task { name priority taskStatus: status } } } }`,
			expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"Database Migration","priority":"HIGH","taskStatus":"TODO"}}}}`,
		},
		{
			name:     "query field resolvers with aliases",
			query:    `query { project(id:2) { urgent: topPriorityItem(category: "task") { __typename } nextDeadline: criticalDeadline(withinDays: 10000) { __typename } } }`,
			expected: `{"data":{"project":{"urgent":{"__typename":"Task"},"nextDeadline":{"__typename":"Milestone"}}}}`,
		},
		// TODO: Allow providing empty arguments for field resolvers.
		// {
		// 	name:     "query top priority item without category",
		// 	query:    `query { project(id:1) { topPriorityItem { __typename ... on Task { name priority status } } } }`,
		// 	expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"Database Migration","priority":"HIGH","status":"TODO"}}}}`,
		// },
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
