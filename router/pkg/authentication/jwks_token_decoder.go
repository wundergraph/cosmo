package authentication

import (
	"context"
	"fmt"
	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"go.uber.org/zap"
	"golang.org/x/time/rate"
	"net/http"
	"net/url"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenDecoder interface {
	Decode(token string) (Claims, error)
}

type jwksTokenDecoder struct {
	jwks keyfunc.Keyfunc
}

// Decode implements TokenDecoder.
func (j *jwksTokenDecoder) Decode(tokenString string) (Claims, error) {
	token, err := jwt.Parse(tokenString, j.jwks.Keyfunc)
	if err != nil {
		return nil, fmt.Errorf("could not validate token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("token is invalid")
	}

	claims := token.Claims.(jwt.MapClaims)
	return Claims(claims), nil
}

type JWKSConfig struct {
	URL               string
	RefreshInterval   time.Duration
	AllowedAlgorithms []string
}

func NewJwksTokenDecoder(ctx context.Context, logger *zap.Logger, configs []JWKSConfig) (TokenDecoder, error) {

	remoteJWKSets := make(map[string]jwkset.Storage)

	for _, c := range configs {
		l := logger.With(zap.String("url", c.URL))
		ur, err := url.ParseRequestURI(c.URL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse given URL %q: %w", c.URL, err)
		}

		jwksetHTTPStorageOptions := jwkset.HTTPClientStorageOptions{
			Client:             httpclient.NewRetryableHTTPClient(l),
			Ctx:                ctx, // Used to end background refresh goroutine.
			HTTPExpectedStatus: http.StatusOK,
			HTTPMethod:         http.MethodGet,
			HTTPTimeout:        15 * time.Second,
			RefreshErrorHandler: func(ctx context.Context, err error) {
				l.Error("Failed to refresh HTTP JWK Set from remote HTTP resource.", zap.Error(err))
			},
			RefreshInterval: c.RefreshInterval,
			Storage:         nil,
		}

		store, err := jwkset.NewStorageFromHTTP(ur, jwksetHTTPStorageOptions)
		if err != nil {
			return nil, fmt.Errorf("failed to create HTTP client storage for JWK provider: %w", err)
		}

		remoteJWKSets[ur.String()] = store
	}

	jwksetHTTPClientOptions := jwkset.HTTPClientOptions{
		HTTPURLs:          remoteJWKSets,
		PrioritizeHTTP:    false,
		RefreshUnknownKID: rate.NewLimiter(rate.Every(5*time.Minute), 1),
	}

	combined, err := jwkset.NewHTTPClient(jwksetHTTPClientOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP client storage for JWK provider: %w", err)
	}

	keyfuncOptions := keyfunc.Options{
		Ctx:          ctx,
		Storage:      combined,
		UseWhitelist: []jwkset.USE{jwkset.UseSig},
	}

	jwks, err := keyfunc.New(keyfuncOptions)
	if err != nil {
		return nil, fmt.Errorf("error initializing JWK: %w", err)
	}

	return &jwksTokenDecoder{
		jwks: jwks,
	}, nil
}
