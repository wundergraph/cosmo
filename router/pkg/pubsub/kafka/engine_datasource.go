package kafka

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

type SubscriptionEventConfiguration struct {
	ProviderID string   `json:"providerId"`
	Topics     []string `json:"topics"`
}

type PublishEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Topic      string          `json:"topic"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() string {
	return fmt.Sprintf(`{"topic":"%s", "data": %s, "providerId":"%s"}`, s.Topic, s.Data, s.ProviderID)
}

type SubscriptionSource struct {
	pubSub *Adapter
}

func (s *SubscriptionSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
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

func (s *SubscriptionSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return err
	}

	return s.pubSub.Subscribe(ctx.Context(), subscriptionConfiguration, updater)
}

type KafkaPublishDataSource struct {
	pubSub *Adapter
}

func (s *KafkaPublishDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) error {
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

func (s *KafkaPublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}
