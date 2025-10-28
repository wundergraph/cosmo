package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type Event struct {
	evt *UnsafeEvent
}

func (e Event) GetData() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.Data)
}

func (e Event) GetHeaders() map[string][]string {
	if e.evt == nil || e.evt.Headers == nil {
		return nil
	}
	return cloneHeaders(e.evt.Headers)
}

func (e Event) GetUnsafeEvent() datasource.UnsafeStreamEvent {
	return e.evt
}

func NewEvent(evt *UnsafeEvent) datasource.StreamEvent {
	return &Event{evt: evt}
}

type UnsafeEvent struct {
	Data    json.RawMessage     `json:"data"`
	Headers map[string][]string `json:"headers"`
}

func (e *UnsafeEvent) GetData() []byte {
	if e == nil {
		return nil
	}
	return e.Data
}

func (e *UnsafeEvent) SetData(data []byte) {
	if e == nil {
		return
	}
	e.Data = slices.Clone(data)
}

func (e *UnsafeEvent) Clone() datasource.UnsafeStreamEvent {
	if e == nil {
		return (*UnsafeEvent)(nil)
	}
	return &UnsafeEvent{
		Data:    slices.Clone(e.Data),
		Headers: cloneHeaders(e.Headers),
	}
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
	Provider  string      `json:"providerId"`
	Subject   string      `json:"subject"`
	Event     UnsafeEvent `json:"event"`
	FieldName string      `json:"rootFieldName"`
}

func (p *publishData) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return &PublishAndRequestEventConfiguration{
		Provider:  p.Provider,
		Subject:   p.Subject,
		FieldName: p.FieldName,
	}
}

func (p *publishData) MarshalJSONTemplate() (string, error) {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	return fmt.Sprintf(`{"subject":"%s", "event": {"data": %s}, "providerId":"%s", "rootFieldName":"%s"}`, p.Subject, p.Event.Data, p.Provider, p.FieldName), nil
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

func (s *SubscriptionSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {

	val, _, _, err := jsonparser.Get(input, "subjects")
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

func (s *SubscriptionSource) Start(ctx *resolve.Context, input []byte, updater datasource.SubscriptionEventUpdater) error {
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

func (s *NatsPublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishData publishData
	if err := json.Unmarshal(input, &publishData); err != nil {
		return err
	}

	if err := s.pubSub.Publish(ctx, publishData.PublishEventConfiguration(), []datasource.StreamEvent{Event{evt: &publishData.Event}}); err != nil {
		// err will not be returned but only logged inside PubSubProvider.Publish to avoid a "unable to fetch from subgraph" error
		_, errWrite := io.WriteString(out, `{"success": false}`)
		return errWrite
	}
	_, err := io.WriteString(out, `{"success": true}`)
	return err
}

func (s *NatsPublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

type NatsRequestDataSource struct {
	pubSub datasource.Adapter
}

func (s *NatsRequestDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishData publishData
	if err := json.Unmarshal(input, &publishData); err != nil {
		return err
	}

	providerBase, ok := s.pubSub.(*datasource.PubSubProvider)
	if !ok {
		return fmt.Errorf("adapter for provider %s is not of the right type", publishData.Provider)
	}

	adapter, ok := providerBase.Adapter.(Adapter)
	if !ok {
		return fmt.Errorf("adapter for provider %s is not of the right type", publishData.Provider)
	}

	return adapter.Request(ctx, publishData.PublishEventConfiguration(), Event{evt: &publishData.Event}, out)
}

func (s *NatsRequestDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) error {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishAndRequestEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
var _ datasource.UnsafeStreamEvent = (*UnsafeEvent)(nil)
