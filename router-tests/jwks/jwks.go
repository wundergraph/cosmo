package jwks

import (
	"context"
	"github.com/MicahParks/jwkset"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	jwksHTTPPath = "/.well-known/jwks.json"
)

type Server struct {
	providers  map[string]Crypto
	httpServer *httptest.Server
	storage    jwkset.Storage
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
	ctx := context.Background()

	rawJWKS, err := s.storage.JSON(ctx)
	if err != nil {
		log.Fatalf("Failed to get the server's JWKS.\nError: %s", err)
	}
	_, _ = w.Write(rawJWKS)
}

func (s *Server) JWKSURL() string {
	return s.httpServer.URL + jwksHTTPPath
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
	s.httpServer = httptest.NewServer(mux)
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
