package datasource

import (
	"encoding/json"
	"fmt"

	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type uniqueRequestIdFn func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error

type PubSubSubscriptionDataSource[C SubscriptionEventConfiguration] struct {
	pubSub                 Adapter
	uniqueRequestID        uniqueRequestIdFn
	subscriptionOnStartFns []SubscriptionOnStartFn
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionEventConfiguration(input []byte) SubscriptionEventConfiguration {
	var subscriptionConfiguration C
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return nil
	}
	return subscriptionConfiguration
}

func (s *PubSubSubscriptionDataSource[C]) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
	return s.uniqueRequestID(ctx, input, xxh)
}

func (s *PubSubSubscriptionDataSource[C]) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	subConf := s.SubscriptionEventConfiguration(input)
	if subConf == nil {
		return fmt.Errorf("no subscription configuration found")
	}

	conf, ok := subConf.(C)
	if !ok {
		return fmt.Errorf("invalid subscription configuration")
	}

	return s.pubSub.Subscribe(ctx.Context(), conf, NewSubscriptionEventUpdater(updater))
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionOnStart(ctx *resolve.Context, input []byte) (close bool, err error) {
	for _, fn := range s.subscriptionOnStartFns {
		close, err = fn(ctx, s.SubscriptionEventConfiguration(input))
		if err != nil || close {
			return
		}
	}

	return
}

func (s *PubSubSubscriptionDataSource[C]) SetSubscriptionOnStartFns(fns ...SubscriptionOnStartFn) {
	s.subscriptionOnStartFns = append(s.subscriptionOnStartFns, fns...)
}

func NewPubSubSubscriptionDataSource[C SubscriptionEventConfiguration](pubSub Adapter, uniqueRequestIdFn uniqueRequestIdFn) *PubSubSubscriptionDataSource[C] {
	return &PubSubSubscriptionDataSource[C]{
		pubSub:          pubSub,
		uniqueRequestID: uniqueRequestIdFn,
	}
}
