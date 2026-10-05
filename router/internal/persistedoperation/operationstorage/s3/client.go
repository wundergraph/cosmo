package s3

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/s3client"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
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

var _ persistedoperation.StorageClient = (*Client)(nil)

// NewClient creates a new S3 client that can be used to retrieve persisted operations
func NewClient(endpoint string, options *Options) (*Client, error) {
	client := &Client{
		options: options,
		tracer: options.TraceProvider.Tracer(
			"wundergraph/cosmo/router/s3_persisted_operations_client",
			trace.WithInstrumentationVersion("0.0.1"),
		),
	}

	minioClient, err := s3client.New(endpoint, options.AccessKeyID, options.SecretAccessKey, options.Region, options.UseSSL)
	if err != nil {
		return nil, err
	}
	client.client = minioClient

	return client, nil
}

func (c Client) PersistedOperation(ctx context.Context, clientName, sha256Hash string) ([]byte, error) {
	content, err := c.persistedOperation(ctx, clientName, sha256Hash)
	if err != nil {
		return nil, err
	}

	return content, nil
}

func (c Client) persistedOperation(ctx context.Context, clientName, sha256Hash string) ([]byte, error) {
	objectPath := fmt.Sprintf("%s/%s.json", c.options.ObjectPathPrefix, sha256Hash)
	reader, err := c.client.GetObject(ctx, c.options.BucketName, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = reader.Close()
	}()

	body, err := io.ReadAll(reader)
	if err != nil {
		// GetObject is lazy, so a missing object only surfaces on the first read.
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, &persistedoperation.PersistentOperationNotFoundError{
				ClientName: clientName,
				Sha256Hash: sha256Hash,
			}
		}
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
