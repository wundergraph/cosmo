package s3

import (
	"context"
	"fmt"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"io"
)

type Option func(*Client)

type Client struct {
	client  *minio.Client
	options *ClientOptions
}

type ClientOptions struct {
	AccessKeyID      string
	SecretAccessKey  string
	Region           string
	UseSSL           bool
	BucketName       string
	ObjectPathPrefix string
}

// NewClient creates a new S3 client that can be used to retrieve persisted operations
func NewClient(endpoint string, options *ClientOptions) (persistedoperation.Client, error) {

	client := &Client{
		options: options,
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

func (c Client) PersistedOperation(ctx context.Context, _clientName string, sha256Hash string) ([]byte, error) {

	objectPath := fmt.Sprintf("%s/%s", c.options.ObjectPathPrefix, sha256Hash)
	reader, err := c.client.GetObject(ctx, c.options.BucketName, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	return body, nil
}

func (c Client) Close() {}
