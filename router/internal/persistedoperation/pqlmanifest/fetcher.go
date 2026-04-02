package pqlmanifest

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.uber.org/zap"
)

type Fetcher struct {
	cdnURL              *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID string
	httpClient     *http.Client
	logger         *zap.Logger
}

// NewFetcher creates a new manifest fetcher. It reuses JWT extraction and HTTP client
// setup patterns from the CDN persisted operations client.
func NewFetcher(endpoint, token string, logger *zap.Logger) (*Fetcher, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	logger = logger.With(
		zap.String("component", "pql_manifest_fetcher"),
		zap.String("url", endpoint),
	)

	return &Fetcher{
		cdnURL:              u,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(claims.FederatedGraphID),
		organizationID:      url.PathEscape(claims.OrganizationID),
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
		logger:              logger,
	}, nil
}

// Fetch downloads the manifest from the CDN. It GETs /{orgId}/{fedGraphId}/operations/manifest.json
// with Bearer auth, using If-None-Match for conditional requests. The CDN returns 304 Not Modified
// when the ETag matches, avoiding a full download. Returns (manifest, changed, err).
func (f *Fetcher) Fetch(ctx context.Context, currentRevision string) (*Manifest, bool, error) {
	manifestPath := fmt.Sprintf("/%s/%s/operations/manifest.json", f.organizationID, f.federatedGraphID)
	manifestURL := f.cdnURL.ResolveReference(&url.URL{Path: manifestPath})

	req, err := http.NewRequestWithContext(ctx, "GET", manifestURL.String(), nil)
	if err != nil {
		return nil, false, err
	}

	req.Header.Set("Authorization", "Bearer "+f.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")
	if currentRevision != "" {
		req.Header.Set("If-None-Match", `"`+currentRevision+`"`)
	}

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode == http.StatusNotModified {
		return nil, false, nil
	}

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return nil, false, errors.New("PQL manifest not found on CDN")
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, false, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return nil, false, errors.New("bad request")
		}
		return nil, false, fmt.Errorf("unexpected status code when loading PQL manifest, statusCode: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body

	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, false, fmt.Errorf("could not create gzip reader: %w", err)
		}
		defer func() {
			_ = r.Close()
		}()
		reader = r
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, false, fmt.Errorf("could not read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, false, errors.New("empty response body")
	}

	var manifest Manifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, false, fmt.Errorf("could not unmarshal PQL manifest: %w", err)
	}

	if err := validateManifest(&manifest); err != nil {
		return nil, false, fmt.Errorf("invalid PQL manifest: %w", err)
	}

	return &manifest, true, nil
}
