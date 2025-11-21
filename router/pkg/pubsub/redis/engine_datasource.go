package redis

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

type Event struct {
	evt *MutableEvent
}

func (e Event) GetData() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.Data)
}

func (e Event) Clone() datasource.MutableStreamEvent {
	return e.evt.Clone()
}

func (e Event) Decode(v any) error {
	return e.evt.Decode(v)
}

type MutableEvent struct {
	Data json.RawMessage `json:"data"`
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
	e.Data = data
}

func (e *MutableEvent) Clone() datasource.MutableStreamEvent {
	if e == nil {
		return nil
	}

	return &MutableEvent{
		Data: slices.Clone(e.Data),
	}
}

func (e *MutableEvent) Decode(v any) error {
	return json.Unmarshal(e.Data, v)
}

// SubscriptionEventConfiguration contains configuration for subscription events
type SubscriptionEventConfiguration struct {
	Provider  string   `json:"providerId"`
	Channels  []string `json:"channels"`
	FieldName string   `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (s *SubscriptionEventConfiguration) ProviderID() string {
	return s.Provider
}

// ProviderType returns the provider type
func (s *SubscriptionEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeRedis
}

// RootFieldName returns the root field name
func (s *SubscriptionEventConfiguration) RootFieldName() string {
	return s.FieldName
}

// publishData is a private type that is used to pass data from the engine to the provider

type publishData struct {
	Provider  string       `json:"providerId"`
	Channel   string       `json:"channel"`
	Event     MutableEvent `json:"event"`
	FieldName string       `json:"rootFieldName"`
}

func (p *publishData) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return &PublishEventConfiguration{
		Provider:  p.Provider,
		Channel:   p.Channel,
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

	builder.WriteString(`{"channel":`)
	topicBytes, err := goccyjson.Marshal(p.Channel)
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

// PublishEventConfiguration contains configuration for publish events
type PublishEventConfiguration struct {
	Provider  string `json:"providerId"`
	Channel   string `json:"channel"`
	FieldName string `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (p *PublishEventConfiguration) ProviderID() string {
	return p.Provider
}

// ProviderType returns the provider type
func (p *PublishEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeRedis
}

// RootFieldName returns the root field name
func (p *PublishEventConfiguration) RootFieldName() string {
	return p.FieldName
}

// SubscriptionDataSource implements resolve.SubscriptionDataSource for Redis
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

// UniqueRequestID computes a unique ID for the subscription request
func (s *SubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
	val, _, _, err := jsonparser.Get(input, "channels")
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

// Start starts the subscription
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

// LoadInitialData implements the interface method (not used for this subscription type)
func (s *SubscriptionDataSource) LoadInitialData(ctx context.Context) (initial []byte, err error) {
	return nil, nil
}

// PublishDataSource implements resolve.DataSource for Redis publishing
type PublishDataSource struct {
	pubSub datasource.Adapter
}

// Load processes a request to publish to Redis
func (s *PublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
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

// LoadWithFiles implements resolve.DataSource.LoadWithFiles (not used for this type)
func (s *PublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
var _ datasource.MutableStreamEvent = (*MutableEvent)(nil)
