package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type StreamConfiguration struct {
	Consumer                  string `json:"consumer"`
	ConsumerInactiveThreshold int32  `json:"consumerInactiveThreshold"`
	StreamName                string `json:"streamName"`
}

type SubscriptionEventConfiguration struct {
	ProviderID          string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishAndRequestEventConfiguration) MarshalJSONTemplate() string {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	return fmt.Sprintf(`{"subject":"%s", "data": %s, "providerId":"%s"}`, s.Subject, s.Data, s.ProviderID)
}

type SubscriptionSource struct {
	pubSub Adapter
}

func (s *SubscriptionSource) Start(ctx *resolve.Context, header http.Header, input []byte, updater resolve.SubscriptionUpdater) error {
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

func (s *NatsPublishDataSource) Load(ctx context.Context, headers http.Header, input []byte) (data []byte, err error) {
	var publishConfiguration PublishAndRequestEventConfiguration
	err = json.Unmarshal(input, &publishConfiguration)
	if err != nil {
		return nil, err
	}

	if err := s.pubSub.Publish(ctx, publishConfiguration); err != nil {
		return []byte(`{"success": false}`), nil
	}
	return []byte(`{"success": true}`), nil
}

func (s *NatsPublishDataSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) (data []byte, err error) {
	panic("not implemented")
}

type NatsRequestDataSource struct {
	pubSub Adapter
}

func (s *NatsRequestDataSource) Load(ctx context.Context, headers http.Header, input []byte) (data []byte, err error) {
	var subscriptionConfiguration PublishAndRequestEventConfiguration
	err = json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	err = s.pubSub.Request(ctx, subscriptionConfiguration, &buf)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *NatsRequestDataSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) (data []byte, err error) {
	panic("not implemented")
}
