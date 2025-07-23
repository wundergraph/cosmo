package authentication

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"golang.org/x/time/rate"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
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

	Secret    string
	Algorithm string
	KeyId     string
}

func NewJwksTokenDecoder(ctx context.Context, logger *zap.Logger, configs []JWKSConfig) (TokenDecoder, error) {

	remoteJWKSets := make(map[string]jwkset.Storage)

	given := jwkset.NewMemoryStorage()

	for _, c := range configs {
		if c.URL != "" {
			l := logger.With(zap.String("url", c.URL))

			jwksetHTTPStorageOptions := jwkset.HTTPClientStorageOptions{
				Client:             newOIDCDiscoveryClient(httpclient.NewRetryableHTTPClient(l)),
				Ctx:                ctx, // Used to end background refresh goroutine.
				HTTPExpectedStatus: http.StatusOK,
				HTTPMethod:         http.MethodGet,
				HTTPTimeout:        15 * time.Second,
				RefreshErrorHandler: func(_ context.Context, err error) {
					l.Error("Failed to refresh HTTP JWK Set from remote HTTP resource.", zap.Error(err))
				},
				RefreshInterval: c.RefreshInterval,
				Storage:         NewValidationStore(logger, nil, c.AllowedAlgorithms),
			}

			store, err := jwkset.NewStorageFromHTTP(c.URL, jwksetHTTPStorageOptions)
			if err != nil {
				return nil, fmt.Errorf("failed to create HTTP client storage for JWK provider: %w", err)
			}

			remoteJWKSets[c.URL] = store
		} else if c.Secret != "" {
			marshalOptions := jwkset.JWKMarshalOptions{
				Private: true,
			}
			if len(c.Secret) < 32 {
				logger.Warn("Using a short secret for JWKs may lead to weak security. Consider using a longer secret.")
			}

			alg := jwkset.ALG(c.Algorithm)
			if !alg.IANARegistered() {
				return nil, fmt.Errorf("unsupported algorithm: %s", c.Algorithm)
			}
			metadata := jwkset.JWKMetadataOptions{
				ALG: alg,
				KID: c.KeyId,
				USE: jwkset.UseSig,
			}
			jwkOptions := jwkset.JWKOptions{
				Marshal:  marshalOptions,
				Metadata: metadata,
			}
			jwk, err := jwkset.NewJWKFromKey([]byte(c.Secret), jwkOptions)
			if err != nil {
				return nil, fmt.Errorf("failed to create JWK from secret: %w", err)
			}

			err = given.KeyWrite(ctx, jwk)
			if err != nil {
				return nil, fmt.Errorf("failed to write JWK to storage: %w", err)
			}
		}
	}

	jwksetHTTPClientOptions := jwkset.HTTPClientOptions{
		Given:             given,
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
