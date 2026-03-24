package pqlmanifest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync/atomic"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

type Manifest struct {
	Version     int               `json:"version"`
	Revision    string            `json:"revision"`
	GeneratedAt string            `json:"generatedAt"`
	Operations  map[string]string `json:"operations"` // sha256 hash -> operation body
}

type Store struct {
	manifest atomic.Pointer[Manifest]
	logger   *zap.Logger
}

func NewStore(logger *zap.Logger) *Store {
	return &Store{
		logger: logger,
	}
}

// Load swaps the manifest atomically.
func (s *Store) Load(manifest *Manifest) {
	s.manifest.Store(manifest)
}

// LookupByHash performs an O(1) map lookup by sha256 hash.
func (s *Store) LookupByHash(sha256Hash string) (body []byte, found bool) {
	m := s.manifest.Load()
	if m == nil {
		return nil, false
	}

	op, ok := m.Operations[sha256Hash]
	if !ok {
		return nil, false
	}

	return []byte(op), true
}

// LoadFromFile reads a manifest JSON file from disk and loads it into the store.
func (s *Store) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read manifest file: %w", err)
	}

	return s.loadFromData(data)
}

// LoadFromS3 fetches a manifest from an S3 bucket and loads it into the store.
func (s *Store) LoadFromS3(ctx context.Context, provider config.S3StorageProvider, objectPath string) error {
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

	minioClient, err := minio.New(provider.Endpoint, &minio.Options{
		Creds:  credentials.NewChainCredentials(providers),
		Region: provider.Region,
		Secure: provider.Secure,
	})
	if err != nil {
		return fmt.Errorf("failed to create S3 client: %w", err)
	}

	reader, err := minioClient.GetObject(ctx, provider.Bucket, objectPath, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to get object from S3: %w", err)
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("failed to read S3 object: %w", err)
	}

	return s.loadFromData(data)
}

// LoadFromCDN fetches a manifest from a CDN endpoint and loads it into the store.
func (s *Store) LoadFromCDN(ctx context.Context, cdnURL, token, manifestPath string) error {
	reqURL := cdnURL + "/" + manifestPath

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create CDN request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch manifest from CDN: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("CDN returned status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read CDN response: %w", err)
	}

	return s.loadFromData(data)
}

// loadFromData parses and validates manifest JSON data and loads it into the store.
func (s *Store) loadFromData(data []byte) error {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}

	if err := validateManifest(&manifest); err != nil {
		return fmt.Errorf("invalid manifest: %w", err)
	}

	s.Load(&manifest)
	return nil
}

func validateManifest(m *Manifest) error {
	if m.Version != 1 {
		return fmt.Errorf("unsupported manifest version %d, expected 1", m.Version)
	}
	if m.Revision == "" {
		return fmt.Errorf("manifest revision is required")
	}
	if m.Operations == nil {
		return fmt.Errorf("manifest operations field is required")
	}
	return nil
}

// IsLoaded returns whether a manifest has been loaded.
func (s *Store) IsLoaded() bool {
	return s.manifest.Load() != nil
}

// Revision returns the current manifest revision for polling.
func (s *Store) Revision() string {
	m := s.manifest.Load()
	if m == nil {
		return ""
	}
	return m.Revision
}

// OperationCount returns the number of operations in the manifest.
func (s *Store) OperationCount() int {
	m := s.manifest.Load()
	if m == nil {
		return 0
	}
	return len(m.Operations)
}
