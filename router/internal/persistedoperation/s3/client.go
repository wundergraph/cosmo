package s3

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"io"
)

type Option func(*Client)

type Client struct {
	client  *minio.Client
	options *Options
	tracer  trace.Tracer
}

type Options struct {
	AccessKeyID      string
	SecretAccessKey  string
	Region           string
	UseSSL           bool
	BucketName       string
	ObjectPathPrefix string
	TraceProvider    *sdktrace.TracerProvider
}

// NewClient creates a new S3 client that can be used to retrieve persisted operations
func NewClient(endpoint string, options *Options) (persistedoperation.Client, error) {

	client := &Client{
		options: options,
		tracer: options.TraceProvider.Tracer(
			"wundergraph/cosmo/router/s3_persisted_operations_client",
			trace.WithInstrumentationVersion("0.0.1"),
		),
	}

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(options.AccessKeyID, options.SecretAccessKey, ""),
		Region: options.Region,
		Secure: options.UseSSL,
	})
	if err != nil {
		return nil, err
	}
	client.client = minioClient

	return client, nil
}

func (c Client) PersistedOperation(ctx context.Context, clientName, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error) {
	ctx, span := c.tracer.Start(ctx, "Load Persisted Operation",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attributes...),
	)
	defer span.End()

	content, err := c.persistedOperation(ctx, clientName, sha256Hash, attributes)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	return content, nil
}

func (c Client) persistedOperation(ctx context.Context, clientName, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error) {
	objectPath := fmt.Sprintf("%s/%s.json", c.options.ObjectPathPrefix, sha256Hash)
	reader, err := c.client.GetObject(ctx, c.options.BucketName, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	var po persistedoperation.PersistedOperation
	err = json.Unmarshal(body, &po)
	if err != nil {
		return nil, err
	}

	return []byte(po.Body), nil
}

func (c Client) Close() {}
