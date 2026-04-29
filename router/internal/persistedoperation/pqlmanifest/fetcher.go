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
	cdnFallbackURL      *url.URL
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
func NewFetcher(endpoint, fallbackEndpoint, token string, logger *zap.Logger) (*Fetcher, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	var fu *url.URL
	if fallbackEndpoint != "" {
		fu, err = url.Parse(fallbackEndpoint)
		if err != nil {
			return nil, fmt.Errorf("invalid CDN fallback URL %q: %w", fallbackEndpoint, err)
		}
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
		cdnFallbackURL:      fu,
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
	resp, body, err := f.doFetch(ctx, currentRevision, f.cdnURL)

	if err != nil && f.cdnFallbackURL != nil && httpclient.IsCDNFallbackEligible(resp, err) {
		f.logger.Warn("Primary CDN failed, attempting fallback CDN for PQL manifest",
			zap.Error(err),
			zap.String("fallback_url", f.cdnFallbackURL.String()),
		)
		_, body, err = f.doFetch(ctx, currentRevision, f.cdnFallbackURL)
	}

	if err != nil {
		return nil, false, err
	}
	if body == nil {
		// 304 Not Modified
		return nil, false, nil
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

func (f *Fetcher) doFetch(ctx context.Context, currentRevision string, baseURL *url.URL) (*http.Response, []byte, error) {
	manifestPath := fmt.Sprintf("/%s/%s/operations/manifest.json", f.organizationID, f.federatedGraphID)
	manifestURL := baseURL.ResolveReference(&url.URL{Path: manifestPath})

	req, err := http.NewRequestWithContext(ctx, "GET", manifestURL.String(), nil)
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("Authorization", "Bearer "+f.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")
	if currentRevision != "" {
		req.Header.Set("If-None-Match", `"`+currentRevision+`"`)
	}

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode == http.StatusNotModified {
		return resp, nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return resp, nil, errors.New("PQL manifest not found on CDN")
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return resp, nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return resp, nil, errors.New("bad request")
		}
		return resp, nil, fmt.Errorf("unexpected status code when loading PQL manifest, statusCode: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body

	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return resp, nil, fmt.Errorf("could not create gzip reader: %w", err)
		}
		defer func() {
			_ = r.Close()
		}()
		reader = r
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return resp, nil, fmt.Errorf("could not read response body: %w", err)
	}

	if len(body) == 0 {
		return resp, nil, errors.New("empty response body")
	}

	return resp, body, nil
}
