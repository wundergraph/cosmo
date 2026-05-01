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
	"time"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"go.uber.org/zap"
)

const (
	sigResponseHeaderName = "X-Signature-SHA256"
)

var (
	ErrMissingSignatureHeader       = errors.New("signature header not found in CDN response")
	ErrInvalidSignature             = errors.New("invalid config signature, potential tampering detected")
	ErrConfigNotFound         error = &routerConfigNotFoundError{}
)

type Options struct {
	Logger                     *zap.Logger
	SignatureKey               string
	RouterCompatibilityVersion int
	FallbackEndpoint           string
}

type Client struct {
	cdnURL              *url.URL
	cdnFallbackURL      *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID             string
	httpClient                 *http.Client
	logger                     *zap.Logger
	hash                       hash.Hash
	routerCompatibilityVersion int
}

type routerConfigNotFoundError struct {
	federatedGraphId string
}

type getRouterConfigRequestBody struct {
	Version string `json:"version"`
}

func (e *routerConfigNotFoundError) FederatedGraphId() string {
	return e.federatedGraphId
}

func (e *routerConfigNotFoundError) Error() string {
	return fmt.Sprintf("router config of the federated graph %s not found. This is expected if you have not deployed any subgraphs yet", e.federatedGraphId)
}

// NewClient creates a new CDN client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewClient(endpoint string, token string, opts *Options) (routerconfig.Client, error) {
	if token == "" {
		return nil, errors.New("token is required for CDN config provider")
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	var fu *url.URL
	if opts.FallbackEndpoint != "" {
		fu, err = url.Parse(opts.FallbackEndpoint)
		if err != nil {
			return nil, fmt.Errorf("invalid CDN fallback URL %q: %w", opts.FallbackEndpoint, err)
		}
	}

	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger.With(zap.String("component", "router_config_client"))

	c := &Client{
		cdnURL:                     u,
		cdnFallbackURL:             fu,
		authenticationToken:        token,
		federatedGraphID:           url.PathEscape(claims.FederatedGraphID),
		organizationID:             url.PathEscape(claims.OrganizationID),
		httpClient:                 httpclient.NewRetryableHTTPClient(logger),
		logger:                     opts.Logger,
		routerCompatibilityVersion: opts.RouterCompatibilityVersion,
	}

	if opts.SignatureKey != "" {
		c.hash = hmac.New(sha256.New, []byte(opts.SignatureKey))
	}

	return c, nil
}

func (cdn *Client) getRouterConfig(ctx context.Context, version string, _ time.Time) ([]byte, error) {
	resp, body, err := cdn.doGetRouterConfig(ctx, version, cdn.cdnURL)

	if err != nil && cdn.cdnFallbackURL != nil && httpclient.IsCDNFallbackEligible(resp, err) {
		primaryErr := err
		cdn.logger.Warn("Primary CDN failed, attempting fallback CDN for router config",
			zap.Error(err),
			zap.String("fallback_url", cdn.cdnFallbackURL.String()),
		)
		fallbackResp, fallbackBody, fallbackErr := cdn.doGetRouterConfig(ctx, version, cdn.cdnFallbackURL)
		if fallbackErr == nil || errors.Is(fallbackErr, configpoller.ErrConfigNotModified) {
			resp, body, err = fallbackResp, fallbackBody, fallbackErr
		} else {
			return nil, fmt.Errorf("primary CDN failed: %w; fallback CDN also failed: %v", primaryErr, fallbackErr)
		}
	}

	if err != nil {
		return nil, err
	}

	if cdn.hash != nil {
		configSignature := resp.Header.Get(sigResponseHeaderName)
		if configSignature == "" {
			cdn.logger.Error(
				"Signature header not found in CDN response. Ensure that your Admission Controller was able to sign the config. Open the compositions page in the Studio to check the status of the last deployment",
				zap.Error(ErrMissingSignatureHeader),
			)
			return nil, ErrMissingSignatureHeader
		}

		if _, err := cdn.hash.Write(body); err != nil {
			return nil, fmt.Errorf("could not write config body to hmac: %w", err)
		}
		dataHmac := cdn.hash.Sum(nil)
		cdn.hash.Reset()

		rawSignature, err := base64.StdEncoding.DecodeString(configSignature)
		if err != nil {
			return nil, fmt.Errorf("could not hex decode signature key: %w", err)
		}

		if subtle.ConstantTimeCompare(rawSignature, dataHmac) != 1 {
			cdn.logger.Error(
				"Invalid config signature, potential tampering detected. Ensure that your Admission Controller has signed the config correctly. Open the compositions page in the Studio to check the status of the last deployment",
				zap.Error(ErrInvalidSignature),
			)
			return nil, ErrInvalidSignature
		}

		cdn.logger.Info("Config signature validation successful",
			zap.String("federatedGraphID", cdn.federatedGraphID),
			zap.String("signature", configSignature),
		)
	}

	return body, nil
}

func (cdn *Client) doGetRouterConfig(ctx context.Context, version string, baseURL *url.URL) (*http.Response, []byte, error) {
	routerConfigPath := fmt.Sprintf("/%s/%s/routerconfigs/%slatest.json",
		cdn.organizationID,
		cdn.federatedGraphID,
		routerconfig.VersionPath(cdn.routerCompatibilityVersion),
	)
	routerConfigURL := baseURL.ResolveReference(&url.URL{Path: routerConfigPath})

	body, err := json.Marshal(getRouterConfigRequestBody{
		Version: version,
	})
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", routerConfigURL.String(), bytes.NewBuffer(body))
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Add("Authorization", "Bearer "+cdn.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := cdn.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return resp, nil, ErrConfigNotFound
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return resp, nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return resp, nil, errors.New("bad request")
		}
		if resp.StatusCode == http.StatusNotModified {
			return resp, nil, configpoller.ErrConfigNotModified
		}

		return resp, nil, fmt.Errorf("unexpected status code when loading router config, statusCode: %d", resp.StatusCode)
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

	body, err = io.ReadAll(reader)
	if err != nil {
		return resp, nil, fmt.Errorf("could not read the response body: %w", err)
	}

	if len(body) == 0 {
		return resp, nil, errors.New("empty response body")
	}

	return resp, body, nil
}

func (cdn *Client) RouterConfig(ctx context.Context, version string, modifiedSince time.Time) (*routerconfig.Response, error) {
	res := &routerconfig.Response{}

	body, err := cdn.getRouterConfig(ctx, version, modifiedSince)
	if err != nil && errors.Is(err, ErrConfigNotFound) {
		return nil, configpoller.ErrConfigNotFound
	} else if err != nil {
		return nil, err
	}

	/*
	* Unmarshal the response body to a RouterConfig object
	 */

	res.Config, err = execution_config.UnmarshalConfig(body)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal router external router config from CDN: %w", err)
	}
	return res, nil
}
