package s3

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
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
		Secure: options.UseSSL,
	})
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
		return nil, err
	}

	var po persistedoperation.PersistedOperation
	err = json.Unmarshal(body, &po)
	if err != nil {
		return nil, err
	}

	return []byte(po.Body), nil
}

// ReadManifest fetches and parses a PQL manifest from S3 at the given object path.
// If the object path ends with .gz or .zst, the content is decompressed automatically.
// When modifiedSince is non-zero and the object has not been modified, returns (nil, nil).
func (c Client) ReadManifest(ctx context.Context, objectPath string, modifiedSince time.Time) (*pqlmanifest.Manifest, error) {
	opts := minio.GetObjectOptions{}
	if !modifiedSince.IsZero() {
		if err := opts.SetModified(modifiedSince); err != nil {
			return nil, fmt.Errorf("failed to set modified-since on manifest request: %w", err)
		}
	}

	minioReader, err := c.client.GetObject(ctx, c.options.BucketName, objectPath, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to get manifest from S3: %w", err)
	}
	defer func() {
		_ = minioReader.Close()
	}()

	data, err := decompressAndRead(minioReader, objectPath)
	if err != nil {
		// minio surfaces 304 Not Modified as an error on the first read,
		// which may occur inside gzip/zstd header parsing or io.ReadAll.
		var minioErr minio.ErrorResponse
		if errors.As(err, &minioErr) && minioErr.StatusCode == http.StatusNotModified {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read manifest from S3: %w", err)
	}

	return pqlmanifest.ParseManifest(data)
}

// decompressAndRead reads the full content from a reader, decompressing
// based on the file extension (.gz, .zst). Plain content is read as-is.
func decompressAndRead(r io.Reader, objectPath string) ([]byte, error) {
	var reader io.Reader

	switch strings.ToLower(filepath.Ext(objectPath)) {
	case ".gz":
		gr, err := gzip.NewReader(r)
		if err != nil {
			return nil, err
		}
		defer func() {
			_ = gr.Close()
		}()
		reader = gr
	case ".zst":
		zr, err := zstd.NewReader(r)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		reader = zr
	default:
		reader = r
	}

	return io.ReadAll(reader)
}

func (c Client) Close() {}
