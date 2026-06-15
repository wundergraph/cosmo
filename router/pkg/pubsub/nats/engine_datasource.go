package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	goccyjson "github.com/goccy/go-json"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type Event struct {
	evt *MutableEvent
}

func (e *Event) GetData() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.Data)
}

func (e *Event) GetHeaders() map[string][]string {
	if e.evt == nil || e.evt.Headers == nil {
		return nil
	}
	return cloneHeaders(e.evt.Headers)
}

func (e Event) Clone() datasource.MutableStreamEvent {
	return e.evt.Clone()
}

type MutableEvent struct {
	Data    json.RawMessage     `json:"data"`
	Headers map[string][]string `json:"headers"`
}

func (e *MutableEvent) GetData() []byte {
	if e == nil {
		return nil
	}
	return e.Data
}

func (e *MutableEvent) SetData(data []byte) {
	if e == nil {
		return
	}
	e.Data = slices.Clone(data)
}

func (e *MutableEvent) Clone() datasource.MutableStreamEvent {
	if e == nil {
		return nil
	}
	return &MutableEvent{
		Data:    slices.Clone(e.Data),
		Headers: cloneHeaders(e.Headers),
	}
}

func (e *MutableEvent) ToStreamEvent() datasource.StreamEvent {
	return &Event{evt: e}
}

func cloneHeaders(src map[string][]string) map[string][]string {
	if src == nil {
		return nil
	}
	dst := make(map[string][]string, len(src))
	for k, v := range src {
		dst[k] = slices.Clone(v)
	}
	return dst
}

type StreamConfiguration struct {
	Consumer                  string `json:"consumer"`
	ConsumerInactiveThreshold int32  `json:"consumerInactiveThreshold"`
	StreamName                string `json:"streamName"`
}

type SubscriptionEventConfiguration struct {
	Provider            string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
	FieldName           string               `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (s *SubscriptionEventConfiguration) ProviderID() string {
	return s.Provider
}

// ProviderType returns the provider type
func (s *SubscriptionEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeNats
}

// RootFieldName returns the root field name
func (s *SubscriptionEventConfiguration) RootFieldName() string {
	return s.FieldName
}

// publishData is a private type that is used to pass data from the engine to the provider
type publishData struct {
	Provider  string       `json:"providerId"`
	Subject   string       `json:"subject"`
	Event     MutableEvent `json:"event"`
	FieldName string       `json:"rootFieldName"`
}

func (p *publishData) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return &PublishAndRequestEventConfiguration{
		Provider:  p.Provider,
		Subject:   p.Subject,
		FieldName: p.FieldName,
	}
}

func (p *publishData) MarshalJSONTemplate() (string, error) {
	// The content of p.Event.Data containa template placeholders like $$0$$, $$1$$
	// which are not valid JSON. We can't use json.Marshal for these parts.
	// Instead, we use json.Marshal for the safe parts (subject, providerId, rootFieldName)
	// and manually construct the final JSON string.

	var builder strings.Builder
	builder.Grow(256 + len(p.Event.Data))

	builder.WriteString(`{"subject":`)
	topicBytes, err := goccyjson.Marshal(p.Subject)
	if err != nil {
		return "", err
	}
	builder.Write(topicBytes)

	builder.WriteString(`, "event": {"data": `)
	builder.Write(p.Event.Data)

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

type PublishAndRequestEventConfiguration struct {
	Provider  string `json:"providerId"`
	Subject   string `json:"subject"`
	FieldName string `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (p *PublishAndRequestEventConfiguration) ProviderID() string {
	return p.Provider
}

// ProviderType returns the provider type
func (p *PublishAndRequestEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeNats
}

// RootFieldName returns the root field name
func (p *PublishAndRequestEventConfiguration) RootFieldName() string {
	return p.FieldName
}

type SubscriptionSource struct {
	pubSub datasource.Adapter
}

func (s *SubscriptionSource) SubscriptionEventConfiguration(input []byte) datasource.SubscriptionEventConfiguration {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return nil
	}
	return &subscriptionConfiguration
}

func (s *SubscriptionSource) Start(ctx *resolve.Context, header http.Header, input []byte, updater datasource.SubscriptionEventUpdater) error {
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

type NatsPublishDataSource struct {
	pubSub datasource.Adapter
}

func (s *NatsPublishDataSource) Load(ctx context.Context, headers http.Header, input []byte) (data []byte, err error) {
	var publishData publishData
	err = json.Unmarshal(input, &publishData)
	if err != nil {
		return nil, err
	}

	if err := s.pubSub.Publish(ctx, publishData.PublishEventConfiguration(), []datasource.StreamEvent{&Event{evt: &publishData.Event}}); err != nil {
		// err will not be returned but only logged inside PubSubProvider.Publish to avoid a "unable to fetch from subgraph" error
		return []byte(`{"__typename": "edfs__PublishResult", "success": false}`), nil
	}
	return []byte(`{"__typename": "edfs__PublishResult", "success": true}`), nil
}

func (s *NatsPublishDataSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) (data []byte, err error) {
	panic("not implemented")
}

type NatsRequestDataSource struct {
	pubSub datasource.Adapter
}

func (s *NatsRequestDataSource) Load(ctx context.Context, headers http.Header, input []byte) (data []byte, err error) {
	var publishData publishData
	if err := json.Unmarshal(input, &publishData); err != nil {
		return nil, err
	}

	providerBase, ok := s.pubSub.(*datasource.PubSubProvider)
	if !ok {
		return nil, fmt.Errorf("adapter for provider %s is not of the right type", publishData.Provider)
	}

	adapter, ok := providerBase.Adapter.(Adapter)
	if !ok {
		return nil, fmt.Errorf("adapter for provider %s is not of the right type", publishData.Provider)
	}

	return adapter.Request(ctx, publishData.PublishEventConfiguration(), &Event{evt: &publishData.Event})
}

func (s *NatsRequestDataSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) (data []byte, err error) {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishAndRequestEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
var _ datasource.MutableStreamEvent = (*MutableEvent)(nil)
