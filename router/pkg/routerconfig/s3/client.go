package s3

import (
	"context"
	"errors"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"io"
	"net/http"
	"time"
)

type Option func(*Client)

type Client struct {
	client  *minio.Client
	options *ClientOptions
}

type ClientOptions struct {
	AccessKeyID     string
	SecretAccessKey string
	Region          string
	Secure          bool
	BucketName      string
	ObjectPath      string
}

func NewClient(endpoint string, options *ClientOptions) (routerconfig.Client, error) {

	client := &Client{
		options: options,
	}

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(options.AccessKeyID, options.SecretAccessKey, ""),
		Region: options.Region,
		Secure: options.Secure,
	})
	if err != nil {
		return nil, err
	}
	client.client = minioClient

	return client, nil
}

func (c Client) RouterConfig(ctx context.Context, version string, modifiedSince time.Time) (*routerconfig.Response, error) {

	options := minio.GetObjectOptions{}

	if !modifiedSince.IsZero() {
		// Using the time is much easier because the etag can be computed in different ways (CRC, MD5 ...).
		// Additionally, there are several ways when an etag is handled differently e.g. multipart upload
		// See https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html#AmazonS3-Type-Object-ETag
		//
		// The downside of our approach is that the config uploader is responsible to check if the config has changed
		// in order to safe bandwidth. On the controlplane, we don't deploy the config when the subgraph hasn't changed.
		// Even in the worst case, the server will not swap the config unless the router config version has changed.
		if err := options.SetModified(modifiedSince); err != nil {
			return nil, err
		}
	}

	reader, err := c.client.GetObject(ctx, c.options.BucketName, c.options.ObjectPath, options)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	body, err := io.ReadAll(reader)
	if err != nil {
		var minioErr minio.ErrorResponse
		if errors.As(err, &minioErr) && minioErr.StatusCode == http.StatusNotModified {
			return nil, configpoller.ErrConfigNotModified
		}
		return nil, err
	}

	routerConfig, err := execution_config.UnmarshalConfig(body)
	if err != nil {
		return nil, err
	}

	result := &routerconfig.Response{}
	result.Config = routerConfig

	return result, nil
}
