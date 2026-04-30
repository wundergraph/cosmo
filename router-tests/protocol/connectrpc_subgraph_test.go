package integration

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestConnectRPCSubgraph exercises the projects subgraph over the ConnectRPC
// protocol. The same gRPC implementation is reused, but the testenv switches
// the underlying server to a ConnectRPC handler running over H2C, and the
// router is configured to talk to it via Connect with `grpc_protocol`.
//
// Each subtest covers one of the four categories called out in the meeting
// notes (queries, mutations, entity lookups, federation field resolvers) so
// that the new transport is exercised end-to-end against representative
// shapes of the data source.
func TestConnectRPCSubgraph(t *testing.T) {
	t.Parallel()

	connectProtocolOption := core.WithGRPCProtocol(&config.GRPCProtocolConfiguration{
		DefaultProtocol: "connectrpc",
		DefaultEncoding: "proto",
	})

	t.Run("query - simple list", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions:            []core.Option{connectProtocolOption},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
			})
			require.JSONEq(t,
				`{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`,
				res.Body,
			)
		})
	})

	t.Run("query - argument and nested fields", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions:            []core.Option{connectProtocolOption},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Status is omitted because the mutation subtest may run first and
			// flip it to COMPLETED on the shared in-memory mock store.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { project(id: 1) { id name description } }`,
			})
			require.JSONEq(t,
				`{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture"}}}`,
				res.Body,
			)
		})
	})

	t.Run("mutation - update project status", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions:            []core.Option{connectProtocolOption},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// updateProjectStatus(projectId, status) returns a ProjectUpdate.
			// We check the projectId echoes back so we know the request body
			// was marshalled, sent over Connect, and parsed by the subgraph.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateProjectStatus(projectId: "1", status: COMPLETED) { projectId updateType } }`,
			})
			require.NotContains(t, res.Body, `"errors"`)
			require.Contains(t, res.Body, `"projectId":"1"`)
		})
	})

	t.Run("entity lookup - federation _entities", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions:            []core.Option{connectProtocolOption},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Selecting an Employee field that is owned by the projects subgraph
			// triggers a federation entity lookup (LookupEmployeeById) over the
			// Connect transport.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id projects { id name } } }`,
			})
			// We assert on the shape rather than every employee to keep the test
			// resilient to seed-data changes; the important thing is that the
			// nested entity lookup populated the projects array.
			require.Contains(t, res.Body, `"projects":[{"id":"1"`)
			require.Contains(t, res.Body, `"name":"Cloud Migration Overhaul"`)
		})
	})

	t.Run("field resolver - filtered tasks", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions:            []core.Option{connectProtocolOption},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// `filteredTasks` is resolved by a separate ResolveProjectFilteredTasks
			// RPC call after the parent project is loaded. The Connect transport
			// must therefore handle a request triggered from a nested resolver.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { project(id: 1) { filteredTasks(limit: 3) { name status } } }`,
			})
			require.JSONEq(t,
				`{"data":{"project":{"filteredTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"},{"name":"Cloud Provider Selection","status":"COMPLETED"},{"name":"Network Setup","status":"IN_PROGRESS"}]}}}`,
				res.Body,
			)
		})
	})

	t.Run("per-subgraph override - protocol", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions: []core.Option{
				core.WithGRPCProtocol(&config.GRPCProtocolConfiguration{
					// Defaults to gRPC, but override the projects subgraph to Connect.
					DefaultProtocol: "grpc",
					Subgraphs: map[string]config.GRPCProtocolSubgraph{
						"projects": {Protocol: "connectrpc"},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id } }`,
			})
			require.Contains(t, res.Body, `"projects":[{"id":"1"`)
		})
	})

	t.Run("encoding - json", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			EnableConnectRPC:         true,
			RouterOptions: []core.Option{
				core.WithGRPCProtocol(&config.GRPCProtocolConfiguration{
					DefaultProtocol: "connectrpc",
					DefaultEncoding: "json",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { project(id: 1) { id name } }`,
			})
			require.JSONEq(t,
				`{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul"}}}`,
				res.Body,
			)
		})
	})
}
