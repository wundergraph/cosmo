package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// SubscriptionEventConfiguration contains configuration for subscription events
type SubscriptionEventConfiguration struct {
	ProviderID string   `json:"providerId"`
	Channels   []string `json:"channels"`
}

// PublishEventConfiguration contains configuration for publish events
type PublishEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Channel    string          `json:"channel"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() (string, error) {
	return fmt.Sprintf(`{"channel":"%s", "data": %s, "providerId":"%s"}`, s.Channel, s.Data, s.ProviderID), nil
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
