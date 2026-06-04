package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/cespare/xxhash/v2"
	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type uniqueRequestIdFn func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error

type EventBuilderFn func(data []byte) MutableStreamEvent

const subscriptionEventConfigurationContextKeyPrefix = "wg.cosmo.pubsub.subscription_event_configuration."

type subscriptionEventConfigurationStore interface {
	Set(key string, value any)
	Get(key string) (value any, exists bool)
}

// PubSubSubscriptionDataSource is a data source for handling subscriptions using a Pub/Sub mechanism.
// It implements the SubscriptionDataSource interface and HookableSubscriptionDataSource
type PubSubSubscriptionDataSource[C SubscriptionEventConfiguration] struct {
	pubSub          Adapter
	uniqueRequestID uniqueRequestIdFn
	hooks           Hooks
	logger          *zap.Logger
	eventBuilder    EventBuilderFn
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionEventConfiguration(input []byte) (SubscriptionEventConfiguration, error) {
	var subscriptionConfiguration C
	err := json.Unmarshal(input, &subscriptionConfiguration)
	return subscriptionConfiguration, err
}

func (s *PubSubSubscriptionDataSource[C]) subscriptionEventConfiguration(ctx context.Context, input []byte) (SubscriptionEventConfiguration, error) {
	if conf, ok := subscriptionEventConfigurationFromContext(ctx, input); ok {
		return conf, nil
	}
	return s.SubscriptionEventConfiguration(input)
}

func (s *PubSubSubscriptionDataSource[C]) Start(ctx *resolve.Context, header http.Header, input []byte, updater resolve.SubscriptionUpdater) error {
	subConf, err := s.subscriptionEventConfiguration(ctx.Context(), input)
	if err != nil {
		return err
	}

	conf, ok := subConf.(C)
	if !ok {
		return errors.New("invalid subscription configuration")
	}

	logger := s.logger.With(
		zap.String("component", "subscription_event_updater"),
		zap.String("provider_id", conf.ProviderID()),
		zap.String("provider_type", string(conf.ProviderType())),
		zap.String("field_name", conf.RootFieldName()),
	)

	return s.pubSub.Subscribe(ctx.Context(), conf, NewSubscriptionEventUpdater(conf, s.hooks, updater, logger, s.eventBuilder))
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionOnStart(ctx resolve.StartupHookContext, input []byte) (err error) {
	defer func() {
		if r := recover(); r != nil {
			s.logger.
				WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
				Error("[Recovery from handler panic]",
					zap.Any("error", r),
				)
			switch v := r.(type) {
			case error:
				err = v
			default:
				err = fmt.Errorf("%v", r)
			}
		}
	}()

	if len(s.hooks.SubscriptionOnStart.Handlers) == 0 {
		return nil
	}

	conf, err := s.SubscriptionEventConfiguration(input)
	if err != nil {
		return err
	}

	for _, fn := range s.hooks.SubscriptionOnStart.Handlers {
		conf, err = fn(ctx, conf, s.eventBuilder)
		if err != nil {
			return err
		}
		if conf == nil {
			return errors.New("invalid subscription configuration")
		}
	}

	setSubscriptionEventConfiguration(ctx.Context, input, conf)
	return nil
}

func (s *PubSubSubscriptionDataSource[C]) SetHooks(hooks Hooks) {
	s.hooks = hooks
}

var _ SubscriptionDataSource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)
var _ resolve.HookableSubscriptionDataSource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)

func NewPubSubSubscriptionDataSource[C SubscriptionEventConfiguration](pubSub Adapter, uniqueRequestIdFn uniqueRequestIdFn, logger *zap.Logger, eventBuilder EventBuilderFn) *PubSubSubscriptionDataSource[C] {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PubSubSubscriptionDataSource[C]{
		pubSub:          pubSub,
		uniqueRequestID: uniqueRequestIdFn,
		logger:          logger,
		eventBuilder:    eventBuilder,
	}
}

func subscriptionEventConfigurationContextKey(input []byte) string {
	return subscriptionEventConfigurationContextKeyPrefix +
		strconv.Itoa(len(input)) + ":" +
		strconv.FormatUint(xxhash.Sum64(input), 16)
}

func requestContextStore(ctx context.Context) subscriptionEventConfigurationStore {
	if ctx == nil {
		return nil
	}
	store, _ := ctx.Value(rcontext.RequestContextKey).(subscriptionEventConfigurationStore)
	return store
}

func setSubscriptionEventConfiguration(ctx context.Context, input []byte, conf SubscriptionEventConfiguration) {
	store := requestContextStore(ctx)
	if store == nil {
		return
	}
	store.Set(subscriptionEventConfigurationContextKey(input), conf)
}

func subscriptionEventConfigurationFromContext(ctx context.Context, input []byte) (SubscriptionEventConfiguration, bool) {
	store := requestContextStore(ctx)
	if store == nil {
		return nil, false
	}

	value, ok := store.Get(subscriptionEventConfigurationContextKey(input))
	if !ok || value == nil {
		return nil, false
	}

	conf, ok := value.(SubscriptionEventConfiguration)
	return conf, ok
}
