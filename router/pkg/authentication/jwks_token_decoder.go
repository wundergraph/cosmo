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

func NewJwksTokenDecoder(ctx context.Context, logger *zap.Logger, u string, refreshInterval time.Duration) (TokenDecoder, error) {

	logger = logger.With(zap.String("url", u))

	// Create the JWK Set HTTP client.
	remoteJWKSets := make(map[string]jwkset.Storage)

	ur, err := url.ParseRequestURI(u)
	if err != nil {
		return nil, fmt.Errorf("failed to parse given URL %q: %w", u, err)
	}
	jwksetHTTPStorageOptions := jwkset.HTTPClientStorageOptions{
		Client:             httpclient.NewRetryableHTTPClient(logger),
		Ctx:                ctx, // Used to end background refresh goroutine.
		HTTPExpectedStatus: http.StatusOK,
		HTTPMethod:         http.MethodGet,
		HTTPTimeout:        15 * time.Second,
		RefreshErrorHandler: func(ctx context.Context, err error) {
			logger.Error("Failed to refresh HTTP JWK Set from remote HTTP resource.", zap.Error(err))
		},
		RefreshInterval: refreshInterval,
		Storage:         nil,
	}
	store, err := jwkset.NewStorageFromHTTP(ur, jwksetHTTPStorageOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP client storage for JWK provider: %w", err)
	}

	remoteJWKSets[ur.String()] = store

	// Create the JWK Set containing HTTP clients and given keys.
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
