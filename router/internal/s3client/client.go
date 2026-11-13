// Package s3client builds minio clients with the credentials chain shared by every S3 storage provider in the router.
package s3client

import (
	"net/http"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// New creates a minio client. Static credentials are used when set. Otherwise
// the credentials are retrieved from the IAM role of the node.
func New(endpoint, accessKey, secretKey, region string, secure bool) (*minio.Client, error) {
	providers := []credentials.Provider{
		&credentials.Static{
			Value: credentials.Value{
				AccessKeyID:     accessKey,
				SecretAccessKey: secretKey,
				SignerType:      credentials.SignatureV4,
			},
		},
		&credentials.IAM{
			Client: &http.Client{
				Transport: http.DefaultTransport,
			},
		},
	}

	return minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewChainCredentials(providers),
		Region: region,
		Secure: secure,
	})
}
