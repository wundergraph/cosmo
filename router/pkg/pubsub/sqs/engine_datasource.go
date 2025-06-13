package sqs

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
	ProviderID                      string   `json:"providerId"`
	QueueURLs                       []string `json:"queueUrls"`
	MaxNumberOfMessages             int32    `json:"maxNumberOfMessages"`
	VisibilityTimeout               int32    `json:"visibilityTimeout"`
	GenerateReceiveRequestAttemptId bool     `json:"generateReceiveRequestAttemptId"`
}

type PublishEventConfiguration struct {
	ProviderID                     string          `json:"providerId"`
	QueueURL                       string          `json:"queueUrl"`
	Data                           json.RawMessage `json:"data"`
	DelaySeconds                   int32           `json:"delaySeconds"`
	GenerateMessageDeduplicationId bool            `json:"generateMessageDeduplicationId"`
	MessageGroupId                 string          `json:"messageGroupId"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() string {
	// The content of the data field could be not valid JSON, so we can't use json.Marshal
	// e.g. {"id":$$0$$,"update":$$1$$}
	return fmt.Sprintf(`{"queueUrl":"%s", "data": %s, "providerId":"%s", "delaySeconds":%d, "generateMessageDeduplicationId":%t, "messageGroupId":"%s"}`, s.QueueURL, s.Data, s.ProviderID, s.DelaySeconds, s.GenerateMessageDeduplicationId, s.MessageGroupId)
}

type SubscriptionDataSource struct {
	pubSub Adapter
}

func (s *SubscriptionDataSource) UniqueRequestID(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
	val, _, _, err := jsonparser.Get(input, "queueUrls")
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
	if err != nil {
		return err
	}

	val, _, _, err = jsonparser.Get(input, "maxNumberOfMessages")
	if err != nil {
		return err
	}

	_, err = xxh.Write(val)
	if err != nil {
		return err
	}

	val, _, _, err = jsonparser.Get(input, "visibilityTimeout")
	if err != nil {
		return err
	}

	_, err = xxh.Write(val)
	if err != nil {
		return err
	}

	val, _, _, err = jsonparser.Get(input, "generateReceiveRequestAttemptId")
	if err != nil {
		return err
	}

	_, err = xxh.Write(val)
	return err
}

func (s *SubscriptionDataSource) Start(ctx *resolve.Context, input []byte, updater resolve.SubscriptionUpdater) error {
	var subscriptionConfiguration SubscriptionEventConfiguration
	err := json.Unmarshal(input, &subscriptionConfiguration)
	if err != nil {
		return err
	}

	return s.pubSub.Subscribe(ctx.Context(), subscriptionConfiguration, updater)
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
		_, _ = io.WriteString(out, `{"success": false}`)
		return err
	}
	_, err = io.WriteString(out, `{"success": true}`)
	return err
}

func (s *PublishDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}
