package operationmanifest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// S3Loader loads a manifest from an S3 object. It sends If-None-Match with the
// ETag of the last response, so an unchanged object costs one 304 response.
// Stores that ignore If-None-Match return the object every time, and the
// revision check skips the unchanged manifest.
type S3Loader struct {
	client     minio.Core
	bucket     string
	objectPath string
	etag       string
}

func NewS3Loader(provider config.S3StorageProvider, objectPath string) (*S3Loader, error) {
	// ponytail: copy of the credentials chain in operationstorage/s3.NewClient.
	// Share it when a third S3 client shows up.
	providers := []credentials.Provider{
		&credentials.Static{
			Value: credentials.Value{
				AccessKeyID:     provider.AccessKey,
				SecretAccessKey: provider.SecretKey,
				SignerType:      credentials.SignatureV4,
			},
		},
		&credentials.IAM{
			Client: &http.Client{
				Transport: http.DefaultTransport,
			},
		},
	}

	client, err := minio.New(provider.Endpoint, &minio.Options{
		Creds:  credentials.NewChainCredentials(providers),
		Region: provider.Region,
		Secure: provider.Secure,
	})
	if err != nil {
		return nil, err
	}

	return &S3Loader{
		client:     minio.Core{Client: client},
		bucket:     provider.Bucket,
		objectPath: objectPath,
	}, nil
}

// Fetch downloads the manifest object. If the object path ends with .gz or .zst,
// the content is decompressed.
func (l *S3Loader) Fetch(ctx context.Context, currentRevision string) (*Manifest, bool, error) {
	opts := minio.GetObjectOptions{}
	// SetMatchETagExcept rejects an empty ETag.
	if l.etag != "" {
		if err := opts.SetMatchETagExcept(l.etag); err != nil {
			return nil, false, fmt.Errorf("failed to set if-none-match on manifest request: %w", err)
		}
	}

	// Core.GetObject sends one GET and returns the object info with the body.
	// Object.Stat would send a separate HEAD request for small objects.
	body, info, _, err := l.client.GetObject(ctx, l.bucket, l.objectPath, opts)
	if err != nil {
		var minioErr minio.ErrorResponse
		if errors.As(err, &minioErr) && minioErr.StatusCode == http.StatusNotModified {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("failed to get manifest from S3: %w", err)
	}
	defer func() {
		_ = body.Close()
	}()

	data, err := decompressAndRead(body, l.objectPath)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read manifest from S3: %w", err)
	}

	manifest, err := ParseManifest(data)
	if err != nil {
		return nil, false, err
	}

	l.etag = info.ETag

	if manifest.Revision == currentRevision {
		return nil, false, nil
	}

	return manifest, true, nil
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
