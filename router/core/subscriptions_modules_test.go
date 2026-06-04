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
		require.Same(t, originalConfig, ctx.SubscriptionEventConfiguration())
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
