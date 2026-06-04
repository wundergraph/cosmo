package core

import (
	"context"
	"net/http/httptest"
	"slices"
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

func (c *testSubscriptionEventConfig) Clone() datasource.SubscriptionEventConfiguration {
	c2 := *c
	c2.channels = slices.Clone(c.channels)
	return &c2
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
		// The getter returns a defensive copy: equal by value but not the same pointer.
		require.NotSame(t, originalConfig, got)
		require.Equal(t, originalConfig, got)
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
		// Mutating the returned config in place must not affect the live
		// configuration: it is a defensive copy. Only SetSubscriptionEventConfiguration applies changes.
		got := ctx.SubscriptionEventConfiguration().(*testSubscriptionEventConfig)
		got.fieldName = "mutated"
		got.channels[0] = "mutated-channel"
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
