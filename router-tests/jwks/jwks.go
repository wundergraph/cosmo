package jwks

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	jwtKeyID          = "123456789"
	signingMethodType = "RSA" // This should match signingMethod below

	jwksHTTPPath = "/.well-known/jwks.json"
)

var (
	signingMethod = jwt.SigningMethodRS256
)

type Server struct {
	privateKey *rsa.PrivateKey
	httpServer *httptest.Server
}

func (s *Server) Close() {
	s.httpServer.Close()
}

func (s *Server) Token(claims map[string]any) (string, error) {
	token := jwt.NewWithClaims(signingMethod, jwt.MapClaims(claims))
	token.Header["kid"] = jwtKeyID
	return token.SignedString(s.privateKey)
}

type jsonWebKeySet struct {
	Keys []jsonWebKey `json:"keys"`
}

type jsonWebKey struct {
	Algorithm string `json:"alg"`
	Curve     string `json:"crv"`
	Exponent  string `json:"e"`
	K         string `json:"k"`
	ID        string `json:"kid"`
	Modulus   string `json:"n"`
	Type      string `json:"kty"`
	Use       string `json:"use"`
	X         string `json:"x"`
	Y         string `json:"y"`
}

func (s *Server) jwksJSON(w http.ResponseWriter, r *http.Request) {
	k := jsonWebKey{
		Type:      signingMethodType,
		Algorithm: signingMethod.Name,
		Use:       "sig",
		ID:        jwtKeyID,
		Exponent:  base64.URLEncoding.EncodeToString(big.NewInt(int64(s.privateKey.E)).Bytes()),
		Modulus:   base64.URLEncoding.EncodeToString(s.privateKey.N.Bytes()),
	}
	data, err := json.Marshal(jsonWebKeySet{Keys: []jsonWebKey{k}})
	if err != nil {
		panic(err)
	}
	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	if err != nil {
		panic(err)
	}
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
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	s := &Server{
		privateKey: privateKey,
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
