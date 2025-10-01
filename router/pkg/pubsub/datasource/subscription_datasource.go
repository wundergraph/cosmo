package datasource

import (
	"encoding/json"
	"errors"

	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type uniqueRequestIdFn func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error

// PubSubSubscriptionDataSource is a data source for handling subscriptions using a Pub/Sub mechanism.
// It implements the SubscriptionDataSource interface and HookableSubscriptionDataSource
type PubSubSubscriptionDataSource[C SubscriptionEventConfiguration] struct {
	pubSub          Adapter
	uniqueRequestID uniqueRequestIdFn
	hooks           Hooks
	logger          *zap.Logger
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionEventConfiguration(input []byte) (SubscriptionEventConfiguration, error) {
	var subscriptionConfiguration C
	err := json.Unmarshal(input, &subscriptionConfiguration)
	return subscriptionConfiguration, err
}

func (s *PubSubSubscriptionDataSource[C]) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
	return s.uniqueRequestID(ctx, input, xxh)
}

func (s *PubSubSubscriptionDataSource[C]) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	subConf, err := s.SubscriptionEventConfiguration(input)
	if err != nil {
		return err
	}

	conf, ok := subConf.(C)
	if !ok {
		return errors.New("invalid subscription configuration")
	}

	return s.pubSub.Subscribe(ctx.Context(), conf, NewSubscriptionEventUpdater(conf, s.hooks, updater, s.logger))
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionOnStart(ctx resolve.StartupHookContext, input []byte) (err error) {
	for _, fn := range s.hooks.SubscriptionOnStart {
		conf, errConf := s.SubscriptionEventConfiguration(input)
		if errConf != nil {
			return err
		}
		err = fn(ctx, conf)
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *PubSubSubscriptionDataSource[C]) SetHooks(hooks Hooks) {
	s.hooks = hooks
}

var _ SubscriptionDataSource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)
var _ resolve.HookableSubscriptionDataSource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)

func NewPubSubSubscriptionDataSource[C SubscriptionEventConfiguration](pubSub Adapter, uniqueRequestIdFn uniqueRequestIdFn, logger *zap.Logger) *PubSubSubscriptionDataSource[C] {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PubSubSubscriptionDataSource[C]{
		pubSub:          pubSub,
		uniqueRequestID: uniqueRequestIdFn,
		logger:          logger,
	}
}
