package core

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

func TestSubscriptionRootFieldNameUsesSchemaName(t *testing.T) {
	subscription := &resolve.GraphQLSubscription{Response: &resolve.GraphQLResponse{Data: &resolve.Object{
		Fields: []*resolve.Field{{Name: []byte("alias"), Info: &resolve.FieldInfo{Name: "actualSubscription"}}},
	}}}
	name, err := subscriptionRootFieldName(subscription)
	require.NoError(t, err)
	require.Equal(t, "actualSubscription", name)
	_, err = subscriptionRootFieldName(nil)
	require.ErrorContains(t, err, "no root field")
	subscription.Response.Data.Fields[0].Info = nil
	_, err = subscriptionRootFieldName(subscription)
	require.ErrorContains(t, err, "no root field name")
}

func TestSubscriptionRootFieldArgumentsResolveVariablesAndLiterals(t *testing.T) {
	variables, err := astjson.Parse(`{"ids":["show-1","show-2"],"filter":{"region":"US"}}`)
	require.NoError(t, err)
	op := &operationContext{
		content:        `subscription Updates($a: [ID!]!, $b: Filter) { alias: liveShowUpdates(showIds: $a, filter: $b, enabled: true) { id } }`,
		variables:      variables,
		remapVariables: map[string]string{"a": "ids", "b": "filter"},
	}
	got, err := subscriptionRootFieldArguments(op, nil, "liveShowUpdates")
	require.NoError(t, err)
	require.JSONEq(t, `{"showIds":["show-1","show-2"],"filter":{"region":"US"},"enabled":true}`, string(got))
}

func TestSubscriptionRootFieldArgumentsPreserveRemappedNameSwap(t *testing.T) {
	variables, err := astjson.Parse(`{"a":"A","b":"B"}`)
	require.NoError(t, err)
	op := &operationContext{
		content:        `subscription Swap($a: String, $b: String) { updates(first: $a, second: $b) }`,
		variables:      variables,
		remapVariables: map[string]string{"a": "b", "b": "a"},
	}
	got, err := subscriptionRootFieldArguments(op, nil, "updates")
	require.NoError(t, err)
	require.JSONEq(t, `{"first":"B","second":"A"}`, string(got))
}

func TestSubscriptionRootFieldArgumentsApplyFieldDefaults(t *testing.T) {
	schema, report := astparser.ParseGraphqlDocumentString(`type Subscription { updates(optional: String, fallback: String = "default", explicit: String = "default", unmentioned: String = "also-default"): String }`)
	require.False(t, report.HasErrors(), report.Error())
	variables, err := astjson.Parse(`{"explicit":null}`)
	require.NoError(t, err)
	op := &operationContext{
		content:   `subscription Updates($optional: String, $fallback: String, $explicit: String) { updates(optional: $optional, fallback: $fallback, explicit: $explicit) }`,
		variables: variables,
	}
	request := httptest.NewRequest("GET", "/graphql", nil)
	reqCtx := &requestContext{request: request, logger: zap.NewNop(), operation: op}
	subscription := &resolve.GraphQLSubscription{Response: &resolve.GraphQLResponse{Data: &resolve.Object{
		Fields: []*resolve.Field{{Info: &resolve.FieldInfo{Name: "updates"}}},
	}}}
	var got []byte
	h := &GraphQLHandler{executor: &Executor{ClientSchema: &schema}, graphqlSubscriptionHooks: []graphqlSubscriptionLifecycleHandler{{
		onStart: func(ctx GraphQLSubscriptionHookContext) error {
			got = ctx.RootFieldArguments()
			return nil
		},
	}}}
	_, err = h.startGraphQLSubscription(reqCtx, request, subscription)
	require.NoError(t, err)
	require.JSONEq(t, `{"fallback":"default","explicit":null,"unmentioned":"also-default"}`, string(got))
}

func TestGraphQLSubscriptionHookRejectsMissingRootField(t *testing.T) {
	h := &GraphQLHandler{graphqlSubscriptionHooks: []graphqlSubscriptionLifecycleHandler{{onStart: func(GraphQLSubscriptionHookContext) error {
		t.Fatal("hook must not run without a root field name")
		return nil
	}}}}
	end, err := h.startGraphQLSubscription(nil, nil, &resolve.GraphQLSubscription{})
	require.Nil(t, end)
	require.ErrorContains(t, err, "no root field")
}

func TestGraphQLSubscriptionHooksPerSubscriberAndReverseEndOrder(t *testing.T) {
	request := httptest.NewRequest("GET", "/graphql", nil)
	request.Header.Set("X-Request-Identity", "user-42")
	auth := authentication.NewEmptyAuthentication(authentication.DefaultScopeClaim)
	auth.SetScopes([]string{"orders:read"})
	variables, err := astjson.Parse(`{"accountId":"abc"}`)
	require.NoError(t, err)
	operation := &operationContext{name: "WatchOrders", opType: OperationTypeSubscription, hash: 42, content: "subscription WatchOrders { orders }", variables: variables, clientInfo: &ClientInfo{Name: "mobile", Version: "1.2"}}
	ctx := &graphqlSubscriptionHookContext{request: request, logger: zap.NewNop(), operation: operation, authentication: auth, instanceID: "subscriber-1", rootFieldName: "orders"}
	var calls []string
	assertDetails := func(got GraphQLSubscriptionHookContext) {
		require.Same(t, request, got.Request())
		require.Equal(t, "user-42", got.Request().Header.Get("X-Request-Identity"))
		require.Same(t, auth, got.Authentication())
		require.Equal(t, []string{"orders:read"}, got.Authentication().Scopes())
		require.Equal(t, "orders", got.RootFieldName())
		require.Equal(t, "subscriber-1", got.SubscriptionInstanceID())
		require.Equal(t, "WatchOrders", got.Operation().Name())
		require.Equal(t, OperationTypeSubscription, got.Operation().Type())
		require.Equal(t, uint64(42), got.Operation().Hash())
		require.Equal(t, "subscription WatchOrders { orders }", got.Operation().Content())
		require.JSONEq(t, `{"accountId":"abc"}`, string(got.Operation().Variables().MarshalTo(nil)))
		require.Equal(t, ClientInfo{Name: "mobile", Version: "1.2"}, got.Operation().ClientInfo())
	}
	handlers := []graphqlSubscriptionLifecycleHandler{
		{onStart: func(got GraphQLSubscriptionHookContext) error {
			assertDetails(got)
			calls = append(calls, "start-a")
			return nil
		}, onEnd: func(got GraphQLSubscriptionHookContext) { assertDetails(got); calls = append(calls, "end-a") }},
		{onStart: func(GraphQLSubscriptionHookContext) error { calls = append(calls, "start-b"); return nil },
			onEnd: func(GraphQLSubscriptionHookContext) { calls = append(calls, "end-b") }},
	}
	firstEnd, err := startGraphQLSubscriptionHooks(handlers, ctx)
	require.NoError(t, err)
	secondEnd, err := startGraphQLSubscriptionHooks(handlers, ctx)
	require.NoError(t, err)
	firstEnd()
	firstEnd()
	require.Equal(t, []string{"start-a", "start-b", "start-a", "start-b", "end-b", "end-a"}, calls)
	secondEnd()
	require.Equal(t, []string{"start-a", "start-b", "start-a", "start-b", "end-b", "end-a", "end-b", "end-a"}, calls)
}

func TestGraphQLSubscriptionInstancesGetDistinctIDs(t *testing.T) {
	request := httptest.NewRequest("GET", "/graphql", nil)
	operation := &operationContext{clientInfo: &ClientInfo{Name: "mobile"}, content: "subscription { orders }"}
	reqCtx := &requestContext{request: request, logger: zap.NewNop(), operation: operation}
	subscription := &resolve.GraphQLSubscription{Response: &resolve.GraphQLResponse{Data: &resolve.Object{
		Fields: []*resolve.Field{{Info: &resolve.FieldInfo{Name: "orders"}}},
	}}}
	var starts, ends []string
	h := &GraphQLHandler{executor: &Executor{}, graphqlSubscriptionHooks: []graphqlSubscriptionLifecycleHandler{{
		onStart: func(ctx GraphQLSubscriptionHookContext) error {
			starts = append(starts, ctx.SubscriptionInstanceID())
			return nil
		},
		onEnd: func(ctx GraphQLSubscriptionHookContext) {
			ends = append(ends, ctx.SubscriptionInstanceID())
		},
	}}}
	firstEnd, err := h.startGraphQLSubscription(reqCtx, request, subscription)
	require.NoError(t, err)
	secondEnd, err := h.startGraphQLSubscription(reqCtx, request, subscription)
	require.NoError(t, err)
	require.NotEmpty(t, starts[0])
	require.NotEqual(t, starts[0], starts[1])
	firstEnd()
	secondEnd()
	require.Equal(t, starts, ends)
}

func TestGraphQLSubscriptionStartFailureUnwindsSuccessfulHooks(t *testing.T) {
	want := errors.New("reject")
	var calls []string
	handlers := []graphqlSubscriptionLifecycleHandler{
		{onStart: func(GraphQLSubscriptionHookContext) error { calls = append(calls, "start-a"); return nil },
			onEnd: func(GraphQLSubscriptionHookContext) { calls = append(calls, "end-a") }},
		{onStart: func(GraphQLSubscriptionHookContext) error { calls = append(calls, "start-b"); return want },
			onEnd: func(GraphQLSubscriptionHookContext) { calls = append(calls, "end-b") }},
	}
	end, err := startGraphQLSubscriptionHooks(handlers, &graphqlSubscriptionHookContext{logger: zap.NewNop()})
	require.ErrorIs(t, err, want)
	require.Nil(t, end)
	require.Equal(t, []string{"start-a", "start-b", "end-a"}, calls)
}
