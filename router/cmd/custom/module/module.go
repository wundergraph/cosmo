package module

import (
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
)

func init() {
	core.RegisterModule(&CosmoStreamsModule{})
}

type CosmoStreamsModule struct{}

func (m *CosmoStreamsModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "cosmoStreamsModule",
		Priority: 1,
		New: func() core.Module {
			return &CosmoStreamsModule{}
		},
	}
}

func (m *CosmoStreamsModule) OnPublishEvents(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	return events, nil
}

func (m *CosmoStreamsModule) OnReceiveEvents(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
	return events, nil
}

func (m *CosmoStreamsModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHandlerContext) error {
	cfg := ctx.SubscriptionEventConfiguration().(*redis.SubscriptionEventConfiguration)
	cfg.Channels = []string{"test123"}
	//ctx.SetSubscriptionEventConfiguration(cfg)

	return nil
}

// Interface guard
var (
	_ core.StreamPublishEventHandler  = (*CosmoStreamsModule)(nil)
	_ core.StreamReceiveEventHandler  = (*CosmoStreamsModule)(nil)
	_ core.SubscriptionOnStartHandler = (*CosmoStreamsModule)(nil)
)
