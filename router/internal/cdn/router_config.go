package cdn

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/segmentio/asm/base64"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"io"
	"net/http"
	"net/url"
)

const sigResponseHeaderName = "X-Signature-SHA256"

type RouterConfigOptions struct {
	Logger       *zap.Logger
	SignatureKey string
}

type RouterConfigClient struct {
	cdnURL              *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID string
	// signatureKey is the private key used to validate the signature of the received config
	signatureKey string
	httpClient   *http.Client
	logger       *zap.Logger
}

type RouterConfigNotFoundError interface {
	error
	FederatedGraphId() string
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
	return fmt.Sprintf("router config of the federated graph %s not found", e.federatedGraphId)
}

func (cdn *RouterConfigClient) RouterConfig(ctx context.Context, version string) (*nodev1.RouterConfig, error) {
	routerConfigPath := fmt.Sprintf("/%s/%s/routerconfigs/latest.json",
		cdn.organizationID,
		cdn.federatedGraphID,
	)
	routerConfigURL := cdn.cdnURL.ResolveReference(&url.URL{Path: routerConfigPath})

	body, err := json.Marshal(getRouterConfigRequestBody{
		Version: version,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", routerConfigURL.String(), bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Add("Authorization", "Bearer "+cdn.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := cdn.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return nil, &routerConfigNotFoundError{
				federatedGraphId: cdn.federatedGraphID,
			}
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, errors.New("could not authenticate against CDN")
		}

		if resp.StatusCode == http.StatusBadRequest {
			return nil, errors.New("bad request")
		}

		if resp.StatusCode == http.StatusNotModified {
			// indicates that the CDN has no updates for us
			return nil, nil
		}

		return nil, fmt.Errorf("unexpected status code when loading router config, statusCode: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body

	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("could not create gzip reader: %w", err)
		}
		defer r.Close()
		reader = r
	}

	body, err = io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("could not read the response body: %w", err)
	}

	if len(body) == 0 {
		return nil, errors.New("empty response body")
	}

	/*
	* Serialize the response body to a RouterConfig object
	 */

	var routerConfig nodev1.RouterConfig
	err = protojson.Unmarshal(body, &routerConfig)
	if err != nil {
		return nil, fmt.Errorf("could not unmarshal router external router config from CDN: %w", err)
	}

	/**
	* If a signature key is set, we need to validate the signature of the received config
	 */

	if cdn.signatureKey != "" {

		configSignature := resp.Header.Get(sigResponseHeaderName)
		if configSignature == "" {
			return nil, errors.New("signature header not found in CDN response")
		}

		// create a signature of the received config body
		hasher := hmac.New(sha256.New, []byte(cdn.signatureKey))
		if _, err := hasher.Write(body); err != nil {
			return nil, fmt.Errorf("could not write config body to hmac: %w", err)
		}
		dataHmac := hasher.Sum(nil)

		// compare received signature with the one we calculated with the private signature key
		rawSignature, err := base64.StdEncoding.DecodeString(configSignature)
		if err != nil {
			return nil, fmt.Errorf("could not hex decode signature key: %w", err)
		}

		if subtle.ConstantTimeCompare(rawSignature, dataHmac) != 1 {
			return nil, errors.New("invalid config signature, potential tampering detected")
		}

		cdn.logger.Info("Config signature validation successful",
			zap.String("federatedGraphID", cdn.federatedGraphID),
			zap.String("signature", configSignature),
		)
	}

	return &routerConfig, nil
}

// NewRouterConfigClient creates a new CDN client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewRouterConfigClient(endpoint string, token string, opts RouterConfigOptions) (*RouterConfigClient, error) {
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

	return &RouterConfigClient{
		cdnURL:              u,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(claims.FederatedGraphID),
		organizationID:      url.PathEscape(claims.OrganizationID),
		httpClient:          newRetryableHTTPClient(opts.Logger),
		logger:              opts.Logger,
		signatureKey:        opts.SignatureKey,
	}, nil
}
