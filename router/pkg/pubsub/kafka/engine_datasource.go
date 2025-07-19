package kafka

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

// Event represents an event from Kafka
type Event struct {
	Key     []byte            `json:"key"`
	Data    json.RawMessage   `json:"data"`
	Headers map[string][]byte `json:"headers"`
}

func (e *Event) GetData() []byte {
	return e.Data
}

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

type PublishEventConfiguration struct {
	Provider  string `json:"providerId"`
	Topic     string `json:"topic"`
	Event     Event  `json:"event"`
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

func (s *PublishEventConfiguration) MarshalJSONTemplate() (string, error) {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	headers := s.Event.Headers
	if headers == nil {
		headers = make(map[string][]byte)
	}

	headersBytes, err := json.Marshal(headers)
	if err != nil {
		return "", err
	}

	// Properly escape string values for JSON
	topicBytes, err := json.Marshal(s.Topic)
	if err != nil {
		return "", err
	}

	key := s.Event.Key
	if key == nil {
		key = []byte{}
	}
	keyBytes, err := json.Marshal(string(key))
	if err != nil {
		return "", err
	}

	providerBytes, err := json.Marshal(s.ProviderID())
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(`{"topic":%s, "event": {"data": %s, "key": %s, "headers": %s}, "providerId":%s}`, topicBytes, s.Event.Data, keyBytes, headersBytes, providerBytes), nil
}

type SubscriptionDataSource struct {
	pubSub Adapter
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
	conf, ok := subConf.(*SubscriptionEventConfiguration)
	if !ok {
		return fmt.Errorf("invalid subscription configuration")
	}

	return s.pubSub.Subscribe(ctx.Context(), *conf, updater)
}

type PublishDataSource struct {
	pubSub Adapter
}

func (s *PublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
	var publishConfiguration PublishEventConfiguration
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

func (s *PublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
