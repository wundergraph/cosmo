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
	Issuer                                     string   `json:"issuer"`
	AuthorizationEndpoint                      string   `json:"authorization_endpoint"`
	TokenEndpoint                              string   `json:"token_endpoint"`
	TokenEndpointAuthMethodsSupported          []string `json:"token_endpoint_auth_methods_supported"`
	TokenEndpointAuthSigningAlgValuesSupported []string `json:"token_endpoint_auth_signing_alg_values_supported"`
	UserinfoEndpoint                           string   `json:"userinfo_endpoint"`
	CheckSessionIframe                         string   `json:"check_session_iframe"`
	EndSessionEndpoint                         string   `json:"end_session_endpoint"`
	JwksURI                                    string   `json:"jwks_uri"`
	RegistrationEndpoint                       string   `json:"registration_endpoint"`
	ScopesSupported                            []string `json:"scopes_supported"`
	ResponseTypesSupported                     []string `json:"response_types_supported"`
	AcrValuesSupported                         []string `json:"acr_values_supported"`
	SubjectTypesSupported                      []string `json:"subject_types_supported"`
	UserinfoSigningAlgValuesSupported          []string `json:"userinfo_signing_alg_values_supported"`
	UserinfoEncryptionAlgValuesSupported       []string `json:"userinfo_encryption_alg_values_supported"`
	UserinfoEncryptionEncValuesSupported       []string `json:"userinfo_encryption_enc_values_supported"`
	IDTokenSigningAlgValuesSupported           []string `json:"id_token_signing_alg_values_supported"`
	IDTokenEncryptionAlgValuesSupported        []string `json:"id_token_encryption_alg_values_supported"`
	IDTokenEncryptionEncValuesSupported        []string `json:"id_token_encryption_enc_values_supported"`
	RequestObjectSigningAlgValuesSupported     []string `json:"request_object_signing_alg_values_supported"`
	DisplayValuesSupported                     []string `json:"display_values_supported"`
	ClaimTypesSupported                        []string `json:"claim_types_supported"`
	ClaimsSupported                            []string `json:"claims_supported"`
	ClaimsParameterSupported                   bool     `json:"claims_parameter_supported"`
	ServiceDocumentation                       string   `json:"service_documentation"`
	UILocalesSupported                         []string `json:"ui_locales_supported"`
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

	defer resp.Body.Close()

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
