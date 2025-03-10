package jwks

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/hashicorp/consul/sdk/freeport"
)

const (
	jwksHTTPPath = "/.well-known/jwks.json"
	oidcHTTPPath = "/.well-known/openid-configuration"
)

type Server struct {
	providers   map[string]Crypto
	httpServer  *httptest.Server
	storage     jwkset.Storage
	respondTime time.Duration
}

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

func (s *Server) Close() {
	s.httpServer.Close()
}

func (s *Server) Token(claims map[string]any) (string, error) {
	if len(s.providers) == 0 {
		return "", jwt.ErrInvalidKey
	}

	for kid, pr := range s.providers {
		token := jwt.NewWithClaims(pr.SigningMethod(), jwt.MapClaims(claims))
		token.Header[jwkset.HeaderKID] = kid
		return token.SignedString(pr.PrivateKey())
	}

	return "", jwt.ErrInvalidKey
}

func (s *Server) TokenForKID(kid string, claims map[string]any) (string, error) {
	provider, ok := s.providers[kid]
	if !ok {
		return "", jwt.ErrInvalidKey
	}
	token := jwt.NewWithClaims(provider.SigningMethod(), jwt.MapClaims(claims))
	token.Header[jwkset.HeaderKID] = kid
	return token.SignedString(provider.PrivateKey())
}

func (s *Server) jwksJSON(w http.ResponseWriter, r *http.Request) {
	time.Sleep(s.respondTime)

	ctx := context.Background()

	rawJWKS, err := s.storage.JSON(ctx)
	if err != nil {
		log.Fatalf("Failed to get the server's JWKS.\nError: %s", err)
	}
	_, _ = w.Write(rawJWKS)
}

func (s *Server) oidcJSON(w http.ResponseWriter, r *http.Request) {
	time.Sleep(s.respondTime)
	oidc := oidcConfiguration{
		Issuer:                            s.httpServer.URL,
		AuthorizationEndpoint:             s.httpServer.URL + "/auth",
		TokenEndpoint:                     s.httpServer.URL + "/token",
		TokenEndpointAuthMethodsSupported: []string{"client_secret_basic"},
		TokenEndpointAuthSigningAlgValuesSupported: []string{"RS256"},
		UserinfoEndpoint:                       s.httpServer.URL + "/userinfo",
		CheckSessionIframe:                     s.httpServer.URL + "/check-session",
		EndSessionEndpoint:                     s.httpServer.URL + "/end-session",
		JwksURI:                                s.httpServer.URL + jwksHTTPPath,
		RegistrationEndpoint:                   s.httpServer.URL + "/register",
		ScopesSupported:                        []string{"openid", "profile", "email", "address", "phone"},
		ResponseTypesSupported:                 []string{"code", "token", "id_token", "code token", "code id_token", "token id_token", "code token id_token"},
		AcrValuesSupported:                     []string{"0", "1", "2", "3", "4"},
		SubjectTypesSupported:                  []string{"public"},
		UserinfoSigningAlgValuesSupported:      []string{"RS256"},
		UserinfoEncryptionAlgValuesSupported:   []string{"RSA1_5", "RSA-OAEP", "RSA-OAEP-256"},
		UserinfoEncryptionEncValuesSupported:   []string{"A128CBC-HS256", "A192CBC-HS384", "A256CBC-HS512", "A128GCM", "A192GCM", "A256GCM"},
		IDTokenSigningAlgValuesSupported:       []string{"RS256"},
		IDTokenEncryptionAlgValuesSupported:    []string{"RSA1_5", "RSA-OAEP", "RSA-OAEP-256"},
		IDTokenEncryptionEncValuesSupported:    []string{"A128CBC-HS256", "A192CBC-HS384", "A256CBC-HS512", "A128GCM", "A192GCM", "A256GCM"},
		RequestObjectSigningAlgValuesSupported: []string{"none", "RS256"},
		DisplayValuesSupported:                 []string{"page", "popup", "touch", "wap"},
		ClaimTypesSupported:                    []string{"normal", "aggregated", "distributed"},
		ClaimsSupported:                        []string{"sub", "iss", "auth_time", "acr", "name", "given_name", "family_name", "nickname", "profile", "picture", "website", "email", "email_verified", "locale", "zoneinfo", "http://example.com/claims/groups"},
		ClaimsParameterSupported:               true,
		ServiceDocumentation:                   "",
		UILocalesSupported:                     []string{"en-US", "en-GB", "en-CA", "fr-FR", "fr-CA", "de-DE", "es-ES", "es-MX", "it-IT", "ja-JP", "ko-KR", "zh-CN", "zh-TW", "pt-BR", "nl-NL", "ru-RU"},
	}

	data, err := json.Marshal(oidc)
	if err != nil {
		log.Fatalf("Failed to marshal the OIDC configuration.\nError: %s", err)
	}
	_, _ = w.Write(data)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) JWKSURL() string {
	return s.httpServer.URL + jwksHTTPPath
}

func (s *Server) OIDCURL() string {
	return s.httpServer.URL + oidcHTTPPath
}

func (s *Server) waitForServer(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		resp, err := http.Get(s.httpServer.URL)
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		time.Sleep(time.Millisecond * 100)
	}
}

func (s *Server) SetRespondTime(d time.Duration) {
	s.respondTime = d
}

func NewServerWithCrypto(t *testing.T, providers ...Crypto) (*Server, error) {
	t.Helper()
	if len(providers) == 0 {
		t.Fatalf("At least one crypto provider is required.")
	}

	s := &Server{
		providers: make(map[string]Crypto),
		storage:   jwkset.NewMemoryStorage(),
	}

	ctx := context.Background()

	for _, p := range providers {
		kid := p.KID()

		jwk, err := p.MarshalJWK()
		if err != nil {
			t.Fatalf("Failed to marshal the JWK.\nError: %s", err)
		}

		if err := s.storage.KeyWrite(ctx, jwk); err != nil {
			t.Fatalf("Failed to write the JWK to the server's storage.\nError: %s", err)
		}

		s.providers[kid] = p
	}

	mux := http.NewServeMux()
	mux.HandleFunc(jwksHTTPPath, s.jwksJSON)
	mux.HandleFunc(oidcHTTPPath, s.oidcJSON)

	httpServer := httptest.NewUnstartedServer(mux)
	port := freeport.GetOne(t)
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("could not listen on port: %s", err.Error())
	}
	_ = httpServer.Listener.Close()
	httpServer.Listener = l
	httpServer.Start()

	s.httpServer = httpServer
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()
	if err := s.waitForServer(ctx); err != nil {
		t.Fatal(err)
	}
	return s, nil
}

func NewServer(t *testing.T) (*Server, error) {
	rsaCrypto, err := NewRSACrypto("", jwkset.AlgRS256, 2048)
	if err != nil {
		t.Fatalf("Failed to create an RSA crypto provider.\nError: %s", err)
	}
	return NewServerWithCrypto(t, rsaCrypto)
}
