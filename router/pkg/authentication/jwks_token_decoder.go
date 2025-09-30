package authentication

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"golang.org/x/time/rate"

	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"go.uber.org/zap"
)

type TokenDecoder interface {
	Decode(token string) (Claims, error)
}

type jwksTokenDecoder struct {
	jwks jwt.Keyfunc
}

// Decode implements TokenDecoder.
func (j *jwksTokenDecoder) Decode(tokenString string) (Claims, error) {
	token, err := jwt.Parse(tokenString, j.jwks)
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

	Audiences []string

	RefreshUnknownKID RefreshUnknownKIDConfig
}

type RefreshUnknownKIDConfig struct {
	Enabled  bool
	Interval time.Duration
	Burst    int
	MaxWait  time.Duration
}

type audKey struct {
	kid string
	url string
}

type audienceSet map[string]struct{}

func NewJwksTokenDecoder(ctx context.Context, logger *zap.Logger, configs []JWKSConfig) (TokenDecoder, error) {
	audiencesMap := make(map[audKey]audienceSet, len(configs))
	keyFuncMap := make(map[audKey]keyfunc.Keyfunc, len(configs))

	for _, c := range configs {
		if c.URL != "" {
			key := audKey{url: c.URL}
			if _, ok := audiencesMap[key]; ok {
				return nil, fmt.Errorf("duplicate JWK URL found: %s", c.URL)
			}

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

			audiencesMap[key] = getAudienceSet(c.Audiences)

			jwksetHTTPClientOptions := jwkset.HTTPClientOptions{
				HTTPURLs: map[string]jwkset.Storage{
					c.URL: store,
				},
				PrioritizeHTTP: true,
			}

			// Configure the rate limiter for refreshing unknown KIDs
			if c.RefreshUnknownKID.Enabled {
				jwksetHTTPClientOptions.RefreshUnknownKID = rate.NewLimiter(rate.Every(c.RefreshUnknownKID.Interval), c.RefreshUnknownKID.Burst)
				jwksetHTTPClientOptions.RateLimitWaitMax = c.RefreshUnknownKID.MaxWait
			}

			jwks, err := createKeyFunc(ctx, jwksetHTTPClientOptions)
			if err != nil {
				return nil, err
			}
			keyFuncMap[key] = jwks

		} else if c.Secret != "" {
			key := audKey{kid: c.KeyId}
			if _, ok := audiencesMap[key]; ok {
				return nil, fmt.Errorf("duplicate JWK keyid specified found: %s", c.KeyId)
			}

			given := jwkset.NewMemoryStorage()

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

			audiencesMap[key] = getAudienceSet(c.Audiences)

			err = given.KeyWrite(ctx, jwk)
			if err != nil {
				return nil, fmt.Errorf("failed to write JWK to storage: %w", err)
			}

			jwksetHTTPClientOptions := jwkset.HTTPClientOptions{
				Given:          given,
				PrioritizeHTTP: false,
			}

			jwks, err := createKeyFunc(ctx, jwksetHTTPClientOptions)
			if err != nil {
				return nil, err
			}
			keyFuncMap[key] = jwks
		}
	}

	keyFuncWrapper := jwt.Keyfunc(func(token *jwt.Token) (any, error) {
		var errJoin error
		for key, keyFunc := range keyFuncMap {
			pub, err := keyFunc.Keyfunc(token)
			if err != nil {
				errJoin = errors.Join(errJoin, err)
				continue
			}

			expectedAudiences := audiencesMap[key]
			if len(expectedAudiences) > 0 {
				tokenAudiences, err := token.Claims.GetAudience()
				if err != nil {
					return nil, fmt.Errorf("could not get audiences from token claims: %w", err)
				}
				if !hasAudience(tokenAudiences, expectedAudiences) {
					return nil, errUnacceptableAud
				}
			}
			return pub, nil
		}

		return nil, fmt.Errorf("no key found for token: %w", errors.Join(errJoin, jwt.ErrTokenUnverifiable))
	})

	return &jwksTokenDecoder{
		jwks: keyFuncWrapper,
	}, nil
}

func getAudienceSet(audiences []string) audienceSet {
	audSet := make(audienceSet, len(audiences))
	for _, aud := range audiences {
		audSet[aud] = struct{}{}
	}
	return audSet
}

func createKeyFunc(ctx context.Context, options jwkset.HTTPClientOptions) (keyfunc.Keyfunc, error) {
	combined, err := jwkset.NewHTTPClient(options)
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
	return jwks, nil
}

// hasAudience is a common intersection function to check on the token's audiences
func hasAudience(tokenAudiences []string, expectedAudiences audienceSet) bool {
	for _, item := range tokenAudiences {
		if _, found := expectedAudiences[item]; found {
			return true
		}
	}
	return false
}
