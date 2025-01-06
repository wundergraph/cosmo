package jwks

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"github.com/MicahParks/jwkset"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	jwtKeyID = "123456789"

	jwksHTTPPath = "/.well-known/jwks.json"
)

var (
	signingMethod = jwt.SigningMethodRS256
)

type Server struct {
	privateKey *rsa.PrivateKey
	httpServer *httptest.Server
	storage    jwkset.Storage
}

func (s *Server) Close() {
	s.httpServer.Close()
}

func (s *Server) Token(claims map[string]any) (string, error) {
	token := jwt.NewWithClaims(signingMethod, jwt.MapClaims(claims))
	token.Header[jwkset.HeaderKID] = jwtKeyID
	return token.SignedString(s.privateKey)
}

func (s *Server) jwksJSON(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	rawJWKS, err := s.storage.JSONPublic(ctx)
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

func NewServer(t *testing.T) (*Server, error) {
	ctx := context.Background()

	// Create a cryptographic key.
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("Failed to generate given key.\nError: %s", err)
	}

	// Turn the key into a JWK.
	marshalOptions := jwkset.JWKMarshalOptions{
		Private: true,
	}
	metadata := jwkset.JWKMetadataOptions{
		ALG: jwkset.AlgRS256,
		KID: jwtKeyID,
		USE: jwkset.UseSig,
	}
	options := jwkset.JWKOptions{
		Marshal:  marshalOptions,
		Metadata: metadata,
	}

	jwk, err := jwkset.NewJWKFromKey(priv, options)
	if err != nil {
		t.Fatalf("Failed to create a JWK from the given key.\nError: %s", err)
	}

	// Write the JWK to the server's storage.
	serverStore := jwkset.NewMemoryStorage()
	err = serverStore.KeyWrite(ctx, jwk)
	if err != nil {
		t.Fatalf("Failed to write the JWK to the server's storage.\nError: %s", err)
	}

	s := &Server{
		privateKey: priv,
		storage:    serverStore,
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
