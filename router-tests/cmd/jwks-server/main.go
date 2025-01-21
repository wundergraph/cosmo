/*
[NOTE]
> For mor information on authentication and authorization, see the router documentation at
> https://cosmo-docs.wundergraph.com/router/authentication-and-authorization

This simple JWKS server can be used to test the router.
Start the server before running an instance of the router to simulate JWKS integration with the router setup through instance.go.

Start with adding the following configuration to your router configuration file to use this server:

authentication:
  jwt:
    jwks:
      # default port is 3344
      - url: "http://localhost:3344/.well-known/jwks.json"
        refresh_interval: 1m
        # optional list of allowed algorithms per JWKS
        algorithms: ["RS256", "EdDSA", "HS256"]
    header_name: Authorization # This is the default value
    header_value_prefix: Bearer # This is the default value
    header_sources:
      - type: header
        name: X-Auth-Token
        value_prefixes: [Token]
authorization:
  require_authentication: true


Next Steps:
1. Run the JWKS server
2. Run the router
3. Navigate to localhost:3002 in your browser to start the playground
4. Make sure to include your header in the playground. e.g.
	* Authorization: Bearer <token>
	* X-Auth-Token: Token <token>
*/

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

var (
	providers = flag.String("providers", "rsa", "Comma separated list of providers to use, allowed values: rsa, ed25519, hmac")
	port      = flag.String("port", "3344", "Port to run the server on")
	kid       = flag.String("kid", "test", "Key ID to use for the providers. Used as a prefix with the provider type to create the key ID. E.g. test_rsa, test_ed25519, test_hmac")
)

type crypto string

const (
	rsa     crypto = "rsa"
	ed25519 crypto = "ed25519"
	hmac    crypto = "hmac"
)

func init() {
	log.SetFlags(log.Lshortfile)

}

func main() {
	log.Println("Starting JWKS server")
	flag.Parse()

	var providerList []jwks.Crypto
	for _, p := range strings.Split(*providers, ",") {
		switch crypto(p) {
		case rsa:

			rsaID := *kid + "_rsa"
			rsa, err := jwks.NewRSACrypto(rsaID, jwkset.AlgRS256, 2048)
			if err != nil {
				log.Fatalf("Failed to create RSA provider.\nError: %s", err)
			}
			providerList = append(providerList, rsa)
		case ed25519:
			edID := *kid + "_ed25519"
			ed, err := jwks.NewED25519Crypto(edID)
			if err != nil {
				log.Fatalf("Failed to create Ed25519 provider.\nError: %s", err)
			}

			providerList = append(providerList, ed)
		case hmac:
			hmID := *kid + "_hmac"
			hm, err := jwks.NewHMACCrypto(hmID, jwkset.AlgHS256)
			if err != nil {
				log.Fatalf("Failed to create HMAC provider.\nError: %s", err)
			}

			providerList = append(providerList, hm)
		default:
			log.Fatalf("Unsupported test provider (for now): %s", p)
		}
	}

	s, err := NewServerWithCrypto(providerList...)
	if err != nil {
		log.Fatalf("Failed to create the server.\nError: %s", err)
	}

	log.Println("Starting server on port", *port)

	// Create shutdown signal hook

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil {
			if !errors.Is(err, http.ErrServerClosed) {
				log.Fatalf("Failed to start the server.\nError: %s", err)
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	if err := s.waitForServerRunning(ctx); err != nil {
		log.Fatalf("Failed to wait for the server to start.\nError: %s", err)
	}
	cancel()

	if err := s.printTokensForKeys(map[string]any{"sub": "test"}); err != nil {
		log.Fatalf("Failed to print tokens for keys.\nError: %s", err)
	}

	<-sigs

	s.close()

}

const (
	jwksHTTPPath = "/.well-known/jwks.json"
)

type server struct {
	providers  map[string]jwks.Crypto
	httpServer *http.Server
	storage    jwkset.Storage
}

func (s *server) close() {
	s.httpServer.Close()
}

func (s *server) waitForServerRunning(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		resp, err := http.Get(fmt.Sprintf("http://localhost:%s", *port))
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		time.Sleep(time.Millisecond * 100)
	}
}

func (s *server) printTokensForKeys(claims map[string]any) error {
	var tokens []string
	for keyID := range s.providers {
		token, err := s.tokenForKID(keyID, claims)
		if err != nil {
			return err
		}

		tokens = append(tokens, fmt.Sprintf("%s Token: %s", keyID, token))
	}

	fmt.Println(strings.Join(tokens, "\n"))
	return nil
}

func (s *server) tokenForKID(kid string, claims map[string]any) (string, error) {
	provider, ok := s.providers[kid]
	if !ok {
		return "", jwt.ErrInvalidKey
	}
	token := jwt.NewWithClaims(provider.SigningMethod(), jwt.MapClaims(claims))
	token.Header[jwkset.HeaderKID] = kid
	return token.SignedString(provider.PrivateKey())
}

func (s *server) jwksJSON(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	rawJWKS, err := s.storage.JSON(ctx)
	if err != nil {
		log.Fatalf("Failed to get the server's JWKS.\nError: %s", err)
	}
	_, _ = w.Write(rawJWKS)
}

func NewServerWithCrypto(providers ...jwks.Crypto) (*server, error) {
	if len(providers) == 0 {
		return nil, errors.New("no providers provided")
	}

	s := &server{
		providers: make(map[string]jwks.Crypto),
		storage:   jwkset.NewMemoryStorage(),
	}

	ctx := context.Background()

	for _, p := range providers {
		kid := p.KID()

		jwk, err := p.MarshalJWK()
		if err != nil {
			return nil, err
		}

		if err := s.storage.KeyWrite(ctx, jwk); err != nil {
			return nil, err
		}

		s.providers[kid] = p
	}

	mux := http.NewServeMux()
	mux.HandleFunc(jwksHTTPPath, s.jwksJSON)

	srv := &http.Server{
		Addr:    ":3344",
		Handler: mux,
	}

	s.httpServer = srv

	return s, nil
}
