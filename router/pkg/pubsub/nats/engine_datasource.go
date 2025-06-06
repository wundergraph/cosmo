package nats

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
