package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

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
	cursors          Cursors
}

func (s *PubSubSubscriptionDataSource[C]) SubscriptionEventConfiguration(input []byte) (SubscriptionEventConfiguration, error) {
	var subscriptionConfiguration C
	if err := json.Unmarshal(input, &subscriptionConfiguration); err != nil {
		return subscriptionConfiguration, err
	}
	return subscriptionConfiguration, nil
}

// ValidateDeliveryGuarantee rejects clients whose requested delivery guarantee can't be served,
// verifies the cursor of a resuming client and returns what was negotiated for the client.
// It gets the context of the subscribing client, unlike Start, which only gets the context
// of the first subscriber of a trigger.
func (s *PubSubSubscriptionDataSource[C]) ValidateDeliveryGuarantee(ctx *resolve.Context, input []byte) (resolve.NegotiatedDeliveryGuarantee, error) {
	var zero resolve.NegotiatedDeliveryGuarantee

	var subscriptionConfiguration C
	if err := json.Unmarshal(input, &subscriptionConfiguration); err != nil {
		return zero, err
	}

	availableGuarantee := subscriptionConfiguration.DeliveryGuaranteeMode()
	negotiatedGuarantee, err := NegotiateDeliveryGuarantee(availableGuarantee, input)
	if err != nil {
		return zero, err
	}

	resumeToken, resuming, err := resumeCursorToken(input)
	if err != nil {
		return zero, err
	}

	if negotiatedGuarantee != DeliveryGuaranteeCursor {
		// A cursor presented by a client that did not negotiate the cursor guarantee
		// is rejected rather than honoured.
		if resuming {
			return zero, &DeliveryGuaranteeError{
				Code:      DeliveryGuaranteeErrorCodeUnsupported,
				Supported: SupportedDeliveryGuarantees(availableGuarantee),
				Message:   "A cursor can only be resumed by a subscription that requests the cursor delivery guarantee",
			}
		}
		return resolve.NegotiatedDeliveryGuarantee{Guarantee: string(negotiatedGuarantee)}, nil
	}

	binding, err := s.validateCursorBinding(ctx, subscriptionConfiguration)
	if err != nil {
		return zero, err
	}

	negotiated := resolve.NegotiatedDeliveryGuarantee{Guarantee: string(negotiatedGuarantee)}
	if !resuming {
		return negotiated, nil
	}

	if !supportsCursorResume(s.pubSub) {
		return zero, &DeliveryGuaranteeError{
			Code:      DeliveryGuaranteeErrorCodeUnsupported,
			Supported: SupportedDeliveryGuarantees(availableGuarantee),
			Message:   "This provider can't resume a subscription from a cursor",
		}
	}

	// Verification happens exactly once, here, and the verified cursor travels to Start on the
	// resolve context. It covers the key, the signature over the request data (provider type,
	// provider id and topics), the client identity and the resume window.
	if _, err := s.cursors.Codec.Verify(resumeToken, binding.requestData, binding.identity); err != nil {
		return zero, err
	}

	negotiated.ResumeToken = resumeToken
	return negotiated, nil
}

// resumeCursorToken returns the cursor a client presented in body.extensions.streamsCursor.
// An absent or null key means the client does not resume. Anything that is not a non-empty
// string is rejected as an invalid cursor rather than ignored.
func resumeCursorToken(input []byte) (string, bool, error) {
	value, dataType, _, err := jsonparser.Get(input, "body", "extensions", cursorExtensionKey)
	if err != nil || dataType == jsonparser.Null {
		return "", false, nil
	}

	invalid := &DeliveryGuaranteeError{
		Code:    DeliveryGuaranteeErrorCodeCursorInvalid,
		Message: "The cursor is invalid: " + cursorExtensionKey + " must be a non-empty string",
	}
	if dataType != jsonparser.String {
		return "", false, invalid
	}
	token, err := jsonparser.ParseString(value)
	if err != nil || strings.TrimSpace(token) == "" {
		return "", false, invalid
	}
	return token, true, nil
}

// validateCursorBinding resolves the cursor binding up front, so a client that can't be
// issued cursors fails before it receives any event. The binding is also what a resume cursor
// is verified against, so identity and request data are computed once.
func (s *PubSubSubscriptionDataSource[C]) validateCursorBinding(ctx *resolve.Context, subscriptionConfiguration C) (cursorBinding, error) {
	unsatisfiable := &DeliveryGuaranteeError{
		Code:      DeliveryGuaranteeErrorCodeUnsatisfiable,
		Supported: SupportedDeliveryGuarantees(subscriptionConfiguration.DeliveryGuaranteeMode()),
		Message:   "The requested delivery guarantee can't be satisfied",
	}
	if !s.cursors.Enabled() {
		return cursorBinding{}, unsatisfiable
	}

	binding, err := newCursorBinding(ctx.Context(), s.cursors.SubscriberBinding, subscriptionConfiguration)
	if err != nil {
		if guaranteeErr, ok := errors.AsType[*DeliveryGuaranteeError](err); ok {
			if guaranteeErr.Supported == nil {
				guaranteeErr.Supported = unsatisfiable.Supported
			}
			return cursorBinding{}, guaranteeErr
		}
		s.logger.Error("Resolving cursor binding failed", zap.Error(err))
		return cursorBinding{}, unsatisfiable
	}
	return binding, nil
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

	negotiated := ctx.DeliveryGuarantee()
	negotiatedGuarantee := DeliveryGuarantee(negotiated.Guarantee)
	if negotiatedGuarantee == "" {
		// Hypothetical fallback. In practice the guarantee should already be set by the engine.
		negotiatedGuarantee, err = NegotiateDeliveryGuarantee(conf.DeliveryGuaranteeMode(), input)
		if err != nil {
			return err
		}
	}

	logger := s.logger.With(
		zap.String("component", "subscription_event_updater"),
		zap.String("provider_id", conf.ProviderID()),
		zap.String("provider_type", string(conf.ProviderType())),
		zap.String("delivery_guarantee", string(negotiatedGuarantee)),
		zap.String("field_name", conf.RootFieldName()),
	)

	eventUpdater := newSubscriptionEventUpdater(conf, s.hooks, updater, logger, s.eventBuilder)
	if negotiatedGuarantee == DeliveryGuaranteeCursor {
		eventUpdater.enableCursors(s.cursors)
	}

	if negotiated.ResumeToken != "" {
		binding, err := s.validateCursorBinding(ctx, conf)
		if err != nil {
			return err
		}
		cursor, err := s.cursors.Codec.Verify(negotiated.ResumeToken, binding.requestData, binding.identity)
		if err != nil {
			return err
		}
		seekable, ok := s.pubSub.(SeekableAdapter)
		if !ok {
			return &DeliveryGuaranteeError{
				Code:      DeliveryGuaranteeErrorCodeUnsupported,
				Supported: SupportedDeliveryGuarantees(conf.DeliveryGuaranteeMode()),
				Message:   "This provider can't resume a subscription from a cursor",
			}
		}
		return seekable.SubscribeFrom(ctx.Context(), conf, cursor, eventUpdater)
	}

	return s.pubSub.Subscribe(ctx.Context(), conf, negotiatedGuarantee, eventUpdater)
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

func (s *PubSubSubscriptionDataSource[C]) SetCursors(cursors Cursors) {
	s.cursors = cursors
}

func (s *PubSubSubscriptionDataSource[C]) HashTriggerInput(input []byte, xxh *xxhash.Digest) error {
	return s.triggerHashInput(input, xxh)
}

// HashTriggerDeliveryGuarantee adds the negotiated guarantee and the resume cursor to the trigger
// identity, so cursor and at-most-once clients never share a trigger, and neither do two clients
// resuming from different positions: a trigger owns one consumer seeked to one position, so a
// shared trigger would deliver one client's replay to the other.
func (s *PubSubSubscriptionDataSource[C]) HashTriggerDeliveryGuarantee(negotiated resolve.NegotiatedDeliveryGuarantee, xxh *xxhash.Digest) error {
	if _, err := xxh.WriteString(negotiated.Guarantee); err != nil {
		return err
	}
	_, err := xxh.WriteString(negotiated.ResumeToken)
	return err
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
