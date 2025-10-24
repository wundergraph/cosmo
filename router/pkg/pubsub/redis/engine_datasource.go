package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

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

// Start starts the subscription
func (s *SubscriptionDataSource) Start(ctx *resolve.Context, header http.Header, input []byte, updater resolve.SubscriptionUpdater) error {
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
func (s *PublishDataSource) Load(ctx context.Context, headers http.Header, input []byte) (data []byte, err error) {
	var publishConfiguration PublishEventConfiguration
	err = json.Unmarshal(input, &publishConfiguration)
	if err != nil {
		return nil, err
	}

	if err := s.pubSub.Publish(ctx, publishConfiguration); err != nil {
		return []byte(`{"success": false}`), nil
	}
	return []byte(`{"success": true}`), nil
}

// LoadWithFiles implements resolve.DataSource.LoadWithFiles (not used for this type)
func (s *PublishDataSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) (data []byte, err error) {
	panic("not implemented")
}
