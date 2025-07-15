package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// NatsEvent represents an event from NATS
type Event struct {
	Data     json.RawMessage   `json:"data"`
	Metadata map[string]string `json:"metadata"`
}

type StreamConfiguration struct {
	Consumer                  string `json:"consumer"`
	ConsumerInactiveThreshold int32  `json:"consumerInactiveThreshold"`
	StreamName                string `json:"streamName"`
}

type SubscriptionEventConfiguration struct {
	ProviderID_         string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
	RootFieldName_      string               `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (s *SubscriptionEventConfiguration) ProviderID() string {
	return s.ProviderID_
}

// ProviderType returns the provider type
func (s *SubscriptionEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeNats
}

// RootFieldName returns the root field name
func (s *SubscriptionEventConfiguration) RootFieldName() string {
	return s.RootFieldName_
}

type PublishAndRequestEventConfiguration struct {
	ProviderID_    string `json:"providerId"`
	Subject        string `json:"subject"`
	Event          Event  `json:"event"`
	RootFieldName_ string `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (p *PublishAndRequestEventConfiguration) ProviderID() string {
	return p.ProviderID_
}

// ProviderType returns the provider type
func (p *PublishAndRequestEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeNats
}

// RootFieldName returns the root field name
func (p *PublishAndRequestEventConfiguration) RootFieldName() string {
	return p.RootFieldName_
}

func (s *PublishAndRequestEventConfiguration) MarshalJSONTemplate() string {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	return fmt.Sprintf(`{"subject":"%s", "data": %s, "providerId":"%s"}`, s.Subject, s.Event.Data, s.ProviderID_)
}

type SubscriptionSource struct {
	pubSub Adapter
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

func (s *SubscriptionSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return err
	}

	return s.pubSub.Subscribe(ctx.Context(), subscriptionConfiguration, updater)
}

type NatsPublishDataSource struct {
	pubSub Adapter
}

func (s *NatsPublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishConfiguration PublishAndRequestEventConfiguration
	err := json.Unmarshal(input, &publishConfiguration)
	if err != nil {
		return err
	}

	if err := s.pubSub.Publish(ctx, publishConfiguration); err != nil {
		_, err = io.WriteString(out, `{"success": false}`)
		return err
	}
	_, err = io.WriteString(out, `{"success": true}`)
	return err
}

func (s *NatsPublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

type NatsRequestDataSource struct {
	pubSub Adapter
}

func (s *NatsRequestDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var subscriptionConfiguration PublishAndRequestEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return err
	}

	return s.pubSub.Request(ctx, subscriptionConfiguration, out)
}

func (s *NatsRequestDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) error {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishAndRequestEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
