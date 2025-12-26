package kafka

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	goccyjson "github.com/goccy/go-json"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// Event implements datasource.StreamEvent
type Event struct {
	evt *MutableEvent
}

func (e *Event) GetData() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.Data)
}

func (e *Event) GetKey() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.Key)
}

func (e *Event) GetHeaders() map[string][]byte {
	if e.evt == nil {
		return nil
	}
	return cloneHeaders(e.evt.Headers)
}

func (e Event) Clone() datasource.MutableStreamEvent {
	return e.evt.Clone()
}

func cloneHeaders(src map[string][]byte) map[string][]byte {
	if src == nil {
		return nil
	}
	dst := make(map[string][]byte, len(src))
	for k, v := range src {
		dst[k] = slices.Clone(v)
	}
	return dst
}

// MutableEvent implements datasource.MutableEvent
type MutableEvent struct {
	Key     []byte            `json:"key"`
	Data    json.RawMessage   `json:"data"`
	Headers map[string][]byte `json:"headers"`
}

func (e *MutableEvent) GetData() []byte {
	return e.Data
}

func (e *MutableEvent) SetData(data []byte) {
	if e == nil {
		return
	}
	e.Data = data
}

func (e *MutableEvent) Clone() datasource.MutableStreamEvent {
	e2 := *e
	e2.Data = slices.Clone(e.Data)
	e2.Headers = make(map[string][]byte, len(e.Headers))
	for k, v := range e.Headers {
		e2.Headers[k] = slices.Clone(v)
	}
	return &e2
}

// SubscriptionEventConfiguration is a public type that is used to allow access to custom fields
// of the provider
type SubscriptionEventConfiguration struct {
	Provider  string   `json:"providerId"`
	Topics    []string `json:"topics"`
	FieldName string   `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (s *SubscriptionEventConfiguration) ProviderID() string {
	return s.Provider
}

// ProviderType returns the provider type
func (s *SubscriptionEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeKafka
}

// RootFieldName returns the root field name
func (s *SubscriptionEventConfiguration) RootFieldName() string {
	return s.FieldName
}

// publishData is a private type that is used to pass data from the engine to the provider
type publishData struct {
	Provider  string       `json:"providerId"`
	Topic     string       `json:"topic"`
	Event     MutableEvent `json:"event"`
	FieldName string       `json:"rootFieldName"`
}

// PublishEventConfiguration returns the publish event configuration from the publishData type
func (p *publishData) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return &PublishEventConfiguration{
		Provider:  p.Provider,
		Topic:     p.Topic,
		FieldName: p.FieldName,
	}
}

func (p *publishData) MarshalJSONTemplate() (string, error) {
	// The content of p.Event.Data containa template placeholders like $$0$$, $$1$$
	// which are not valid JSON. We can't use json.Marshal for these parts.
	// Instead, we use json.Marshal for the safe parts (headers, topic, providerId, rootFieldName, key)
	// and manually construct the final JSON string.

	headers := p.Event.Headers
	if headers == nil {
		headers = make(map[string][]byte)
	}

	var builder strings.Builder
	builder.Grow(256 + len(p.Event.Data))

	builder.WriteString(`{"topic":`)
	topicBytes, err := goccyjson.Marshal(p.Topic)
	if err != nil {
		return "", err
	}
	builder.Write(topicBytes)

	builder.WriteString(`, "event": {"data": `)
	builder.Write(p.Event.Data)

	builder.WriteString(`, "key": `)
	keyBytes, err := goccyjson.Marshal(string(p.Event.Key))
	if err != nil {
		return "", err
	}
	builder.Write(keyBytes)

	builder.WriteString(`, "headers": `)
	headersBytes, err := goccyjson.Marshal(headers)
	if err != nil {
		return "", err
	}
	builder.Write(headersBytes)

	builder.WriteString(`}, "providerId":`)
	providerBytes, err := goccyjson.Marshal(p.Provider)
	if err != nil {
		return "", err
	}
	builder.Write(providerBytes)

	builder.WriteString(`, "rootFieldName":`)
	rootFieldNameBytes, err := goccyjson.Marshal(p.FieldName)
	if err != nil {
		return "", err
	}
	builder.Write(rootFieldNameBytes)

	builder.WriteString(`}`)

	return builder.String(), nil
}

// PublishEventConfiguration is a public type that is used to allow access to custom fields
// of the provider
type PublishEventConfiguration struct {
	Provider  string `json:"providerId"`
	Topic     string `json:"topic"`
	FieldName string `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (p *PublishEventConfiguration) ProviderID() string {
	return p.Provider
}

// ProviderType returns the provider type
func (p *PublishEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeKafka
}

// RootFieldName returns the root field name
func (p *PublishEventConfiguration) RootFieldName() string {
	return p.FieldName
}

type SubscriptionDataSource struct {
	pubSub datasource.Adapter
}

func (s *SubscriptionDataSource) SubscriptionEventConfiguration(input []byte) datasource.SubscriptionEventConfiguration {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return nil
	}
	return &subscriptionConfiguration
}

func (s *SubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
	val, _, _, err := jsonparser.Get(input, "topics")
	if err != nil {
		return err
	}

	_, err = xxh.Write(val)
	if err != nil {
		return err
	}

	val, _, _, err = jsonparser.Get(input, "providerId")
	if err != nil {
		return err
	}

	_, err = xxh.Write(val)
	return err
}

func (s *SubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater datasource.SubscriptionEventUpdater) error {
	subConf := s.SubscriptionEventConfiguration(input)
	if subConf == nil {
		return fmt.Errorf("no subscription configuration found")
	}

	conf, ok := subConf.(*SubscriptionEventConfiguration)
	if !ok {
		return fmt.Errorf("invalid subscription configuration")
	}

	return s.pubSub.Subscribe(ctx.Context(), conf, updater)
}

type PublishDataSource struct {
	pubSub datasource.Adapter
}

func (s *PublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishData publishData
	if err := json.Unmarshal(input, &publishData); err != nil {
		return err
	}

	if err := s.pubSub.Publish(ctx, publishData.PublishEventConfiguration(), []datasource.StreamEvent{&Event{&publishData.Event}}); err != nil {
		// err will not be returned but only logged inside PubSubProvider.Publish to avoid a "unable to fetch from subgraph" error
		_, errWrite := io.WriteString(out, `{"__typename": "edfs__PublishResult", "success": false}`)
		return errWrite
	}
	_, errWrite := io.WriteString(out, `{"__typename": "edfs__PublishResult", "success": true}`)
	if errWrite != nil {
		return errWrite
	}
	return nil
}

func (s *PublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
var _ datasource.MutableStreamEvent = (*MutableEvent)(nil)
