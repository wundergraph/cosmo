package core

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

func TestSubscriptionRootFieldNameUsesSchemaName(t *testing.T) {
	subscription := &resolve.GraphQLSubscription{Response: &resolve.GraphQLResponse{Data: &resolve.Object{
		Fields: []*resolve.Field{{Name: []byte("alias"), Info: &resolve.FieldInfo{Name: "actualSubscription"}}},
	}}}
	require.Equal(t, "actualSubscription", subscriptionRootFieldName(subscription))
	require.Empty(t, subscriptionRootFieldName(nil))
}

func TestGraphQLSubscriptionHooksPerSubscriberAndReverseEndOrder(t *testing.T) {
	request := httptest.NewRequest("GET", "/graphql", nil)
	auth := authentication.NewEmptyAuthentication(authentication.DefaultScopeClaim)
	operation := &operationContext{name: "WatchOrders", opType: OperationTypeSubscription, clientInfo: &ClientInfo{Name: "mobile", Version: "1.2"}}
	ctx := &graphqlSubscriptionHookContext{request: request, logger: zap.NewNop(), operation: operation, authentication: auth, rootFieldName: "orders"}
	var calls []string
	handlers := []graphqlSubscriptionLifecycleHandler{
		{onStart: func(got GraphQLSubscriptionHookContext) error {
			require.Same(t, request, got.Request())
			require.Same(t, auth, got.Authentication())
			require.Equal(t, "orders", got.RootFieldName())
			require.Equal(t, "WatchOrders", got.Operation().Name())
			require.Equal(t, ClientInfo{Name: "mobile", Version: "1.2"}, got.Operation().ClientInfo())
			calls = append(calls, "start-a")
			return nil
		}, onEnd: func(GraphQLSubscriptionHookContext) { calls = append(calls, "end-a") }},
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
