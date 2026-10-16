package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestAccessLogFilters(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, routerFilter, subgraphFilter string
		routerCount, subgraphCount         int
	}{
		{name: "unset", routerCount: 2, subgraphCount: 2},
		{name: "router only", routerFilter: "false", routerCount: 0, subgraphCount: 2},
		{name: "subgraph only", subgraphFilter: "false", routerCount: 2, subgraphCount: 0},
		{name: "both", routerFilter: "false", subgraphFilter: "false"},
		{name: "operation", routerFilter: "request.operation.name == 'Keep'", subgraphFilter: "request.operation.name == 'Keep'", routerCount: 1, subgraphCount: 1},
		{name: "built in and custom fields", routerFilter: `log.status == 200 && log.latency > duration('0s') && log.path == '/graphql' && log.method == 'POST' && log.ip == '[REDACTED]' && log.log_type == 'request' && (log.request_id ?? '') != '' && (log.config_version ?? '') != '' && log.header == 'Keep' && log.operation == 'Keep' && log.fallback == 'fallback' && log.expression == 'Keep'`, subgraphFilter: `log.status == 200 && log.latency > duration('0s') && log.subgraph_name == subgraph.name && log.subgraph_id == subgraph.id && (log.url ?? '') != '' && log.log_type == 'client/subgraph' && log.operation == 'Keep' && log.fallback == 'fallback' && log.expression == 'Keep'`, routerCount: 1, subgraphCount: 1},
		{name: "filter only body hash variables and tracing", routerFilter: `request.body.raw contains 'Keep' && response.body.raw contains 'data' && request.operation.sha256Hash != '' && fromJSON(request.operation.variables).id == 4`, subgraphFilter: `request.body.raw contains 'Keep' && request.operation.sha256Hash != '' && fromJSON(request.operation.variables).id == 4 && subgraph.response.body.raw contains 'data' && subgraph.request.clientTrace.fetchDuration > duration('0s') && subgraph.request.startTime > 0`, routerCount: 1, subgraphCount: 1},
		{name: "runtime error preserves entries", routerFilter: "int(request.header.Get('absent')) > 0", subgraphFilter: "int(subgraph.response.header.Get('absent')) > 0", routerCount: 2, subgraphCount: 2},
		{name: "sampling all", routerFilter: "rand() < 1", subgraphFilter: "rand() < 1", routerCount: 2, subgraphCount: 2},
		{name: "sampling none", routerFilter: "rand() < 0", subgraphFilter: "rand() < 0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fields := []config.CustomAttribute{
				{Key: "header", ValueFrom: &config.CustomDynamicAttribute{RequestHeader: "X-Test"}},
				{Key: "operation", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldOperationName}},
				{Key: "fallback", Default: "fallback", ValueFrom: &config.CustomDynamicAttribute{RequestHeader: "absent"}},
				{Key: "expression", ValueFrom: &config.CustomDynamicAttribute{Expression: "request.operation.name"}},
			}
			testenv.Run(t, &testenv.Config{
				AccessLogFilter:           tc.routerFilter,
				SubgraphAccessLogFilter:   tc.subgraphFilter,
				SubgraphAccessLogsEnabled: true,
				AccessLogFields:           fields,
				SubgraphAccessLogFields:   fields,
				LogObservation:            testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.DebugLevel},
			}, func(t *testing.T, env *testenv.Environment) {
				for _, name := range []string{"Keep", "Drop"} {
					response := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:     "query " + name + "($id: Int!) { employee(id: $id) { id } }",
						Variables: []byte(`{"id":4}`),
						Header:    http.Header{"X-Test": {name}},
					})
					require.Contains(t, response.Body, `"data"`)
				}
				routerLogs := env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "request"))
				subgraphLogs := env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "client/subgraph"))
				require.Len(t, routerLogs.All(), tc.routerCount)
				require.Len(t, subgraphLogs.All(), tc.subgraphCount)
			})
		})
	}
}

func TestAccessLogFilterStartupValidation(t *testing.T) {
	t.Parallel()
	for _, subgraph := range []bool{false, true} {
		for _, expression := range []string{"request.unknown", "'not a boolean'", "true &&"} {
			name := "router"
			if subgraph {
				name = "subgraph"
			}
			t.Run(name+"/"+expression, func(t *testing.T) {
				t.Parallel()
				cfg := &testenv.Config{SubgraphAccessLogsEnabled: true}
				if subgraph {
					cfg.SubgraphAccessLogFilter = expression
				} else {
					cfg.AccessLogFilter = expression
				}
				err := testenv.RunWithError(t, cfg, func(t *testing.T, _ *testenv.Environment) { t.Fatal("invalid filter must reject startup") })
				require.ErrorContains(t, err, "failed building "+name+" access log filter")
			})
		}
	}
}

func TestAccessLogFilterResponseHeaders(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		SubgraphAccessLogsEnabled: true,
		SubgraphAccessLogFilter:   `subgraph.response.header.Get('X-Filter-Test') == 'included' && log.response_header == 'included'`,
		SubgraphAccessLogFields:   []config.CustomAttribute{{Key: "response_header", ValueFrom: &config.CustomDynamicAttribute{ResponseHeader: "X-Filter-Test"}}},
		LogObservation:            testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		Subgraphs: testenv.SubgraphsConfig{Employees: testenv.SubgraphConfig{Middleware: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Filter-Test", "included")
				next.ServeHTTP(w, r)
			})
		}}},
	}, func(t *testing.T, env *testenv.Environment) {
		env.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id } }`})
		require.Eventually(t, func() bool {
			return env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "client/subgraph")).Len() == 1
		}, time.Second, time.Millisecond)
	})
}

func TestAccessLogFilterEarlyError(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		AccessLogFilter: `request.error != nil`,
		LogObservation:  testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
	}, func(t *testing.T, env *testenv.Environment) {
		response, err := env.MakeGraphQLRequest(testenv.GraphQLRequest{Query: "invalid"})
		require.NoError(t, err)
		require.Contains(t, response.Body, `"errors"`)
		require.Eventually(t, func() bool {
			return env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "request")).Len() == 1
		}, time.Second, time.Millisecond)
	})
}

func TestAccessLogFiltersGraphQLErrors(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		AccessLogFields: []config.CustomAttribute{
			{Key: "error_codes", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldGraphQLErrorCodes}},
			{Key: "error_services", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldGraphQLErrorServices}},
			{Key: "services", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldOperationServices}},
		},
		AccessLogFilter:           `'UNAUTHORIZED' in (log.error_codes ?? []) && 'products' in (log.error_services ?? []) && 'products' in (log.services ?? []) && log.status == 200`,
		SubgraphAccessLogsEnabled: true,
		SubgraphAccessLogFilter:   `subgraph.request.error != nil && log.status == 403 && subgraph.name == 'products'`,
		LogObservation:            testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = true
			cfg.Mode = config.SubgraphErrorPropagationModeWrapped
		},
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
				})
			}},
		},
	}, func(t *testing.T, env *testenv.Environment) {
		response := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employees { id details { forename surname } notes } }`})
		require.Contains(t, response.Body, "UNAUTHORIZED")
		// Without errors the router filter excludes the entry and the products subgraph is not fetched.
		env.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employees { id } }`})
		require.Len(t, env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "request")).All(), 1)
		subgraphLogs := env.Observer().FilterMessage("/graphql").FilterField(zap.String("log_type", "client/subgraph")).All()
		require.Len(t, subgraphLogs, 1)
		require.Equal(t, "products", subgraphLogs[0].ContextMap()["subgraph_name"])
	})
}
