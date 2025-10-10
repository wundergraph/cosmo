package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
)

// Event represents an event from NATS
type Event struct {
	Data    json.RawMessage     `json:"data"`
	Headers map[string][]string `json:"headers"`
}

func (e *Event) GetData() []byte {
	return e.Data
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

type PublishAndRequestEventConfiguration struct {
	Provider  string `json:"providerId"`
	Subject   string `json:"subject"`
	Event     Event  `json:"event"`
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

func (p *PublishAndRequestEventConfiguration) MarshalJSONTemplate() (string, error) {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	return fmt.Sprintf(`{"subject":"%s", "event": {"data": %s}, "providerId":"%s"}`, p.Subject, p.Event.Data, p.ProviderID()), nil
}

type NatsPublishDataSource struct {
	pubSub Adapter
}

func (s *NatsPublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishConfiguration PublishAndRequestEventConfiguration
	if err := json.Unmarshal(input, &publishConfiguration); err != nil {
		return err
	}

	if err := s.pubSub.Publish(ctx, publishConfiguration); err != nil {
		_, err = io.WriteString(out, `{"success": false}`)
		return err
	}
	_, err := io.WriteString(out, `{"success": true}`)
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
	if err := json.Unmarshal(input, &subscriptionConfiguration); err != nil {
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
