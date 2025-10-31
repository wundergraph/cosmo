package s3

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"time"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
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

	// The providers credential chain is used to allow multiple authentication methods.
	providers := []credentials.Provider{
		// Static credentials allow setting the access key and secret access key directly.
		&credentials.Static{
			Value: credentials.Value{
				AccessKeyID:     options.AccessKeyID,
				SecretAccessKey: options.SecretAccessKey,
				SignerType:      credentials.SignatureV4,
			},
		},
		// IAM credentials are retrieved from the EC2 nodes assumed role.
		&credentials.IAM{
			Client: &http.Client{
				Transport: http.DefaultTransport,
			},
		},
	}

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewChainCredentials(providers),
		Region: options.Region,
		Secure: options.Secure,
	})
	if err != nil {
		return nil, err
	}
	client.client = minioClient

	return client, nil
}

func (c Client) getConfigFile(ctx context.Context, modifiedSince time.Time) ([]byte, error) {
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

	minioReader, err := c.client.GetObject(ctx, c.options.BucketName, c.options.ObjectPath, options)
	if err != nil {
		return nil, fmt.Errorf("error getting config from s3: %w", err)
	}

	defer minioReader.Close()

	var configReader io.Reader

	switch filepath.Ext(c.options.ObjectPath) {
	case ".gz":
		gzipReader, err := gzip.NewReader(minioReader)
		if err != nil {
			return nil, fmt.Errorf("error creating gzip reader: %w", err)
		}

		defer gzipReader.Close()

		configReader = gzipReader

	case ".zst":
		zstdReader, err := zstd.NewReader(minioReader)
		if err != nil {
			return nil, fmt.Errorf("error creating zstd reader: %w", err)
		}

		defer zstdReader.Close()

		configReader = zstdReader
	default:
		configReader = minioReader
	}

	result, err := io.ReadAll(configReader)
	if err != nil {
		return nil, fmt.Errorf("error reading file: %w", err)
	}

	return result, nil
}

func (c Client) RouterConfig(ctx context.Context, _ string, modifiedSince time.Time) (*routerconfig.Response, error) {
	res := &routerconfig.Response{}

	body, err := c.getConfigFile(ctx, modifiedSince)
	if err != nil {
		var minioErr minio.ErrorResponse
		if errors.As(err, &minioErr) {
			if minioErr.StatusCode == http.StatusNotModified {
				return nil, configpoller.ErrConfigNotModified
			} else if minioErr.Code == "NoSuchKey" {
				return nil, configpoller.ErrConfigNotFound
			}
		}

		return nil, err
	}

	res.Config, err = execution_config.UnmarshalConfig(body)
	return res, err
}
