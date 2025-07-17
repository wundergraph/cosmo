package start_subscription

import (
	"strings"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
)

const myModuleID = "startSubscriptionModule"

type StartSubscriptionModule struct {
	Logger *zap.Logger
}

func (m *StartSubscriptionModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *StartSubscriptionModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHookContext) error {

	m.Logger.Info("SubscriptionOnStart Hook has been run")

	// check if the provider is nats
	if ctx.SubscriptionEventConfiguration().ProviderType() != datasource.ProviderTypeKafka {
		return nil
	}

	// check if the provider id is the one expected by the module
	if ctx.SubscriptionEventConfiguration().ProviderID() != "my-kafka" {
		return nil
	}

	// check if the subject is the one expected by the module
	kafkaConfig := ctx.SubscriptionEventConfiguration().(*kafka.SubscriptionEventConfiguration)
	if !strings.Contains(kafkaConfig.Topics[0], "employeeUpdated") {
		return nil
	}

	ctx.WriteEvent(&kafka.Event{
		Data: []byte(`{"id": 1, "__typename": "Employee"}`),
	})

	return nil
}

func (m *StartSubscriptionModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &StartSubscriptionModule{}
		},
	}
}

// Interface guard
var (
	_ core.SubscriptionOnStartHandler = (*StartSubscriptionModule)(nil)
)
