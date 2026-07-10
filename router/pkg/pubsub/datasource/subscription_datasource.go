package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type triggerHashInputFn func(input []byte, xxh *xxhash.Digest) error

type EventBuilderFn func(data []byte) MutableStreamEvent

// PubSubSubscriptionDataSource is a data source for handling subscriptions using a Pub/Sub mechanism.
// It implements the SubscriptionDataSource and HookablePubsubDatasource interfaces.
type PubSubSubscriptionDataSource[C SubscriptionEventConfiguration] struct {
	pubSub           Adapter
	triggerHashInput triggerHashInputFn
	hooks            Hooks
	logger           *zap.Logger
	eventBuilder     EventBuilderFn
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionEventConfiguration(input []byte) (SubscriptionEventConfiguration, error) {
	var subscriptionConfiguration C
	err := json.Unmarshal(input, &subscriptionConfiguration)
	return subscriptionConfiguration, err
}

func (s *PubSubSubscriptionDataSource[C]) Start(ctx *resolve.Context, header http.Header, input []byte, updater resolve.SubscriptionUpdater) error {
	subConf, err := s.SubscriptionEventConfiguration(input)
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

	for _, fn := range s.hooks.SubscriptionOnStart.Handlers {
		conf, err := s.SubscriptionEventConfiguration(input)
		if err != nil {
			return err
		}
		err = fn(ctx, conf, s.eventBuilder)
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *PubSubSubscriptionDataSource[C]) SetHooks(hooks Hooks) {
	s.hooks = hooks
}

func (s *PubSubSubscriptionDataSource[C]) HashTriggerInput(input []byte, xxh *xxhash.Digest) error {
	return s.triggerHashInput(input, xxh)
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionOnCreate(ctx context.Context, input []byte) (result []byte, err error) {
	if len(s.hooks.SubscriptionOnCreate.Handlers) == 0 {
		return input, nil
	}

	var conf SubscriptionEventConfiguration

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
				err = fmt.Errorf("%v", v)
			}
		}
	}()

	conf, err = s.SubscriptionEventConfiguration(input)
	if err != nil {
		return nil, err
	}

	for _, fn := range s.hooks.SubscriptionOnCreate.Handlers {
		conf, err = fn(ctx, conf)
		if err != nil {
			return nil, err
		}

		// Check wether a hook developer set config type not compatible with this pubsub datasource
		// (i.e. Kafka configuration on a Redis datasource).
		if _, ok := conf.(C); !ok {
			return nil, errors.New("invalid subscription configuration returned by SubscriptionOnCreate hook")
		}
	}

	return mergeConfigIntoInput(input, conf)
}

// mergeConfigIntoInput re-serializes the (possibly mutated) config back into
// the original input JSON, preserving non-config keys such as initial_payload
// and body.extensions that the resolver may have added.
func mergeConfigIntoInput(input []byte, conf SubscriptionEventConfiguration) ([]byte, error) {
	confBytes, err := json.Marshal(conf)
	if err != nil {
		return nil, err
	}
	err = jsonparser.ObjectEach(confBytes, func(key, value []byte, dataType jsonparser.ValueType, _ int) error {
		rawValue := value
		if dataType == jsonparser.String {
			// jsonparser.ObjectEach strips the surrounding quotes from string values.
			// jsonparser.Set expects valid JSON, so we must re-add them.
			rawValue = make([]byte, len(value)+2)
			rawValue[0] = '"'
			copy(rawValue[1:], value)
			rawValue[len(rawValue)-1] = '"'
		}
		input, err = jsonparser.Set(input, rawValue, string(key))
		return err
	})
	if err != nil {
		return nil, err
	}
	return input, nil
}

var _ SubscriptionDataSource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)

var _ resolve.HookablePubsubDatasource = (*PubSubSubscriptionDataSource[SubscriptionEventConfiguration])(nil)

func NewPubSubSubscriptionDataSource[C SubscriptionEventConfiguration](pubSub Adapter, triggerHashInputFn triggerHashInputFn, logger *zap.Logger, eventBuilder EventBuilderFn) *PubSubSubscriptionDataSource[C] {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PubSubSubscriptionDataSource[C]{
		pubSub:           pubSub,
		triggerHashInput: triggerHashInputFn,
		logger:           logger,
		eventBuilder:     eventBuilder,
	}
}
