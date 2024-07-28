package s3

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"hash"
	"io"
	"net/http"
	"time"
)

type Option func(*ConfigClient)

type ConfigClient struct {
	client   *minio.Client
	etagHash hash.Hash
	options  *Options
}

type Options struct {
	AccessKeyID     string
	SecretAccessKey string
	Region          string
	UseSSL          bool
	BucketName      string
	ObjectPath      string
}

func NewRouterConfigClient(endpoint string, options *Options) (configpoller.RouterConfigClient, error) {

	client := &ConfigClient{
		etagHash: md5.New(),
		options:  options,
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

func (c ConfigClient) RouterConfig(ctx context.Context, version string, modifiedSince time.Time) (*configpoller.RouterConfigResult, error) {

	options := minio.GetObjectOptions{}

	if !modifiedSince.IsZero() {
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

	if _, err := c.etagHash.Write(body); err != nil {
		return nil, err
	}
	defer c.etagHash.Reset()

	routerConfig, err := execution_config.SerializeConfigBytes(body)
	if err != nil {
		return nil, err
	}

	result := &configpoller.RouterConfigResult{}
	result.Config = routerConfig
	result.ETag = hex.EncodeToString(c.etagHash.Sum(nil))

	return result, nil
}
