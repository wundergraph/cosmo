package core

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type testSubscriptionEventConfig struct {
	providerID string
	fieldName  string
	channels   []string
}

func (c *testSubscriptionEventConfig) ProviderID() string {
	return c.providerID
}

func (c *testSubscriptionEventConfig) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeRedis
}

func (c *testSubscriptionEventConfig) RootFieldName() string {
	return c.fieldName
}

func TestNewPubSubSubscriptionOnStartHookReturnsUpdatedSubscriptionEventConfiguration(t *testing.T) {
	originalConfig := &testSubscriptionEventConfig{
		providerID: "provider",
		fieldName:  "original",
	}
	updatedConfig := &testSubscriptionEventConfig{
		providerID: "provider",
		fieldName:  "updated",
	}

	hook := NewPubSubSubscriptionOnStartHook(func(ctx SubscriptionOnStartHandlerContext) error {
		got := ctx.SubscriptionEventConfiguration()
		// The getter returns a read-only wrapper — not the same pointer as the original.
		require.NotSame(t, originalConfig, got)
		require.Equal(t, originalConfig.ProviderID(), got.ProviderID())
		require.Equal(t, originalConfig.RootFieldName(), got.RootFieldName())
		require.True(t, ctx.SetSubscriptionEventConfiguration(updatedConfig))
		return nil
	})

	req := httptest.NewRequest("GET", "/graphql", nil)
	reqCtx := buildRequestContext(requestContextOptions{r: req})
	ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, reqCtx)

	actualConfig, err := hook(resolve.StartupHookContext{
		Context: ctx,
		Updater: func(data []byte) {},
	}, originalConfig, nil)

	require.NoError(t, err)
	require.Same(t, updatedConfig, actualConfig)
}

func TestNewPubSubSubscriptionOnStartHookInPlaceMutationIsNoOp(t *testing.T) {
	originalConfig := &testSubscriptionEventConfig{
		providerID: "provider",
		fieldName:  "original",
		channels:   []string{"original-channel"},
	}

	hook := NewPubSubSubscriptionOnStartHook(func(ctx SubscriptionOnStartHandlerContext) error {
		// The getter returns a read-only wrapper: type-asserting to the concrete
		// type must fail, so direct mutation of the live config is impossible.
		got := ctx.SubscriptionEventConfiguration()
		_, ok := got.(*testSubscriptionEventConfig)
		require.False(t, ok, "type assertion to concrete type must fail")
		return nil
	})

	req := httptest.NewRequest("GET", "/graphql", nil)
	reqCtx := buildRequestContext(requestContextOptions{r: req})
	ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, reqCtx)

	actualConfig, err := hook(resolve.StartupHookContext{
		Context: ctx,
		Updater: func(data []byte) {},
	}, originalConfig, nil)

	require.NoError(t, err)
	// Without SetSubscriptionEventConfiguration the original, unmodified config is returned.
	require.Same(t, originalConfig, actualConfig)
	require.Equal(t, "original", originalConfig.fieldName)
	require.Equal(t, []string{"original-channel"}, originalConfig.channels)
}
