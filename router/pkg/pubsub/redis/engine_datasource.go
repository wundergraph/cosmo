package redis

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

// Event represents an event from Redis
type Event struct {
	Data json.RawMessage `json:"data"`
}

// SubscriptionEventConfiguration contains configuration for subscription events
type SubscriptionEventConfiguration struct {
	ProviderID_    string   `json:"providerId"`
	Channels       []string `json:"channels"`
	RootFieldName_ string   `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (s *SubscriptionEventConfiguration) ProviderID() string {
	return s.ProviderID_
}

// ProviderType returns the provider type
func (s *SubscriptionEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeRedis
}

// RootFieldName returns the root field name
func (s *SubscriptionEventConfiguration) RootFieldName() string {
	return s.RootFieldName_
}

// PublishEventConfiguration contains configuration for publish events
type PublishEventConfiguration struct {
	ProviderID_    string `json:"providerId"`
	Channel        string `json:"channel"`
	Event          Event  `json:"event"`
	RootFieldName_ string `json:"rootFieldName"`
}

// ProviderID returns the provider ID
func (p *PublishEventConfiguration) ProviderID() string {
	return p.ProviderID_
}

// ProviderType returns the provider type
func (p *PublishEventConfiguration) ProviderType() datasource.ProviderType {
	return datasource.ProviderTypeRedis
}

// RootFieldName returns the root field name
func (p *PublishEventConfiguration) RootFieldName() string {
	return p.RootFieldName_
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() (string, error) {
	return fmt.Sprintf(`{"channel":"%s", "data": %s, "providerId":"%s"}`, s.Channel, s.Event.Data, s.ProviderID_), nil
}

// SubscriptionDataSource implements resolve.SubscriptionDataSource for Redis
type SubscriptionDataSource struct {
	pubSub Adapter
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
func (s *SubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return err
	}

	return s.pubSub.Subscribe(ctx.Context(), subscriptionConfiguration, updater)
}

// LoadInitialData implements the interface method (not used for this subscription type)
func (s *SubscriptionDataSource) LoadInitialData(ctx context.Context) (initial []byte, err error) {
	return nil, nil
}

// PublishDataSource implements resolve.DataSource for Redis publishing
type PublishDataSource struct {
	pubSub Adapter
}

// Load processes a request to publish to Redis
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

// LoadWithFiles implements resolve.DataSource.LoadWithFiles (not used for this type)
func (s *PublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

// Interface compliance checks
var _ datasource.SubscriptionEventConfiguration = (*SubscriptionEventConfiguration)(nil)
var _ datasource.PublishEventConfiguration = (*PublishEventConfiguration)(nil)
var _ datasource.StreamEvent = (*Event)(nil)
