package cdn

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"io"
	"net/http"
	"net/url"
)

type RouterConfigOptions struct {
	Logger *zap.Logger
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
	httpClient     *http.Client
	logger         *zap.Logger
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
			return nil, errors.New("could not create gzip reader. " + err.Error())
		}
		defer r.Close()
		reader = r
	}

	body, err = io.ReadAll(reader)
	if err != nil {
		return nil, errors.New("could not read the response body. " + err.Error())
	}

	var routerConfig nodev1.RouterConfig
	err = protojson.Unmarshal(body, &routerConfig)
	if err != nil {
		return nil, errors.New("could not unmarshal router config. " + err.Error())
	}

	return &routerConfig, nil
}

// NewRouterConfigClient creates a new CDN client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewRouterConfigClient(endpoint string, token string, opts PersistentOperationsOptions) (*RouterConfigClient, error) {
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
	}, nil
}
