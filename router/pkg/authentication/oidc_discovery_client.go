package authentication

import (
	"encoding/json"
	"net/http"
	"strings"
)

// oidcDiscoveryPath is the path to the OIDC discovery endpoint.
// Per spec, this path must be /.well-known/openid-configuration.
// See https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig.
const oidcDiscoveryPath = "/.well-known/openid-configuration"

var _ http.RoundTripper = &oidcDiscoveryClient{}

type oidcConfiguration struct {
	JwksURI string `json:"jwks_uri"`
}

// oidcDiscoveryClient is a http.RoundTripper that fetches the JWKS from the OIDC discovery endpoint.
// If the endpoint is not an OIDC discovery endpoint, it delegates the request to the underlying http.Client.
type oidcDiscoveryClient struct {
	httpClient *http.Client
}

func newOIDCDiscoveryClient(httpClient *http.Client) *http.Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	return &http.Client{Transport: &oidcDiscoveryClient{httpClient}}
}

// RoundTrip implements http.RoundTripper.
// If the request is for the OIDC discovery endpoint, it fetches the JWKS from the JWKS URI.
// Otherwise, it delegates the request to the underlying http.Client.
func (c *oidcDiscoveryClient) RoundTrip(req *http.Request) (*http.Response, error) {
	if !strings.HasSuffix(req.URL.Path, oidcDiscoveryPath) {
		return c.httpClient.Do(req)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	defer func() {
		_ = resp.Body.Close()
	}()

	oidcConfig := new(oidcConfiguration)
	if err := json.NewDecoder(resp.Body).Decode(oidcConfig); err != nil {
		return nil, err
	}

	disReq, err := http.NewRequestWithContext(req.Context(), http.MethodGet, oidcConfig.JwksURI, nil)
	if err != nil {
		return nil, err
	}

	disReq.Header = req.Header
	return c.httpClient.Do(disReq)
}
