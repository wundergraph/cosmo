package cdn

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"github.com/wundergraph/cosmo/router/pkg/errs"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"go.uber.org/zap"
)

// SplitFetcher fetches mapper and individual router configs from the CDN
// using simple GET requests (no version negotiation).
type SplitFetcher struct {
	cdnURL              *url.URL
	authenticationToken string
	federatedGraphID    string
	organizationID      string
	httpClient          *http.Client
	logger              *zap.Logger
	hash                hash.Hash // HMAC-SHA256 for signature validation; nil if no key configured
}

// NewSplitFetcher creates a SplitFetcher for the given CDN endpoint and router token.
// It follows the same setup pattern as NewClient.
func NewSplitFetcher(endpoint string, token string, opts *Options) (*SplitFetcher, error) {
	if token == "" {
		return nil, errors.New("token is required for split config fetcher")
	}

	if opts == nil {
		opts = &Options{}
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger.With(zap.String("component", "split_config_fetcher"))

	f := &SplitFetcher{
		cdnURL:              u,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(claims.FederatedGraphID),
		organizationID:      url.PathEscape(claims.OrganizationID),
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
		logger:              logger,
	}

	if opts.SignatureKey != "" {
		f.hash = hmac.New(sha256.New, []byte(opts.SignatureKey))
	}

	return f, nil
}

// post performs an authenticated POST request to the given CDN path, validates the
// optional HMAC signature, and returns the (decompressed) response body.
func (f *SplitFetcher) post(ctx context.Context, path string) ([]byte, error) {
	target := f.cdnURL.ResolveReference(&url.URL{Path: path})

	// This payload tells the cdn to always return a 200 OK instead
	// 304 Not Modified (in case the version did not change). The split config poller
	// already does config change detection, so no need for the CDN to do the same.
	reqBody := []byte(`{"version": ""}`)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Add("Authorization", "Bearer "+f.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	switch resp.StatusCode {
	case http.StatusOK:
		// handled below
	case http.StatusNotFound:
		return nil, errs.ErrFileNotFound
	case http.StatusUnauthorized:
		return nil, errors.New("could not authenticate against CDN")
	case http.StatusBadRequest:
		return nil, errors.New("bad request")
	default:
		return nil, fmt.Errorf("unexpected status code when loading split config, statusCode: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("could not create gzip reader: %w", err)
		}
		defer func() {
			_ = r.Close()
		}()
		reader = r
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("could not read response body: %w", err)
	}
	if len(body) == 0 {
		return nil, errors.New("empty response body")
	}

	// Validate HMAC signature when a key is configured.
	if f.hash != nil {
		configSignature := resp.Header.Get(sigResponseHeaderName)
		if configSignature == "" {
			f.logger.Error(
				"Signature header not found in CDN response. Ensure that your Admission Controller was able to sign the config.",
				zap.Error(errs.ErrMissingSignatureHeader),
			)
			return nil, errs.ErrMissingSignatureHeader
		}

		if _, err := f.hash.Write(body); err != nil {
			return nil, fmt.Errorf("could not write config body to hmac: %w", err)
		}
		dataHmac := f.hash.Sum(nil)
		f.hash.Reset()

		rawSignature, err := base64.StdEncoding.DecodeString(configSignature)
		if err != nil {
			return nil, fmt.Errorf("could not decode signature: %w", err)
		}

		if subtle.ConstantTimeCompare(rawSignature, dataHmac) != 1 {
			f.logger.Error(
				"Invalid config signature, potential tampering detected.",
				zap.Error(errs.ErrInvalidSignature),
			)
			return nil, errs.ErrInvalidSignature
		}

		f.logger.Info("Config signature validation successful",
			zap.String("federatedGraphID", f.federatedGraphID),
			zap.String("signature", configSignature),
		)
	}

	return body, nil
}

// FetchMapper fetches the mapper file and returns the active graph configs and their hashes.
func (f *SplitFetcher) FetchMapper(ctx context.Context) (map[string]string, error) {
	path, err := url.JoinPath("/", f.organizationID, f.federatedGraphID, "manifest/mapper.json")
	if err != nil {
		return nil, fmt.Errorf("could not join path: %w", err)
	}
	body, err := f.post(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("could not fetch mapper: %w", err)
	}

	var activeGraphs map[string]string

	if err := json.Unmarshal(body, &activeGraphs); err != nil {
		return nil, fmt.Errorf("could not unmarshal mapper: %w", err)
	}

	return activeGraphs, nil
}

// FetchConfig fetches a single router config from CDN.
// featureFlagName="" returns the base graph; any other value returns the named feature flag config.
func (f *SplitFetcher) FetchConfig(ctx context.Context, featureFlagName string) (*nodev1.RouterConfig, error) {
	var (
		path string
		err  error
	)

	if featureFlagName == "" {
		path, err = url.JoinPath("/", f.organizationID, f.federatedGraphID, "manifest/latest.json")
	} else {
		path, err = url.JoinPath("/", f.organizationID, f.federatedGraphID, "manifest/feature-flags",
			featureFlagName+".json")
	}

	if err != nil {
		return nil, fmt.Errorf("could not join path: %w", err)
	}

	body, err := f.post(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("could not fetch config for %q: %w", featureFlagName, err)
	}

	cfg, err := execution_config.UnmarshalConfig(body)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal router config for %q: %w", featureFlagName, err)
	}

	return cfg, nil
}
