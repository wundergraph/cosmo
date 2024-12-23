package authentication

import (
	"fmt"
	"go.uber.org/zap"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
)

type TokenDecoder interface {
	Decode(token string) (Claims, error)
	Close()
}

type jwksTokenDecoder struct {
	// JSON Web Key Set, automatically updated in the background
	// by keyfunc.
	jwks *keyfunc.JWKS
}

// Decode implements TokenDecoder.
func (j *jwksTokenDecoder) Decode(tokenString string) (Claims, error) {
	token, err := jwt.Parse(tokenString, j.jwks.Keyfunc)
	if err != nil {
		return nil, fmt.Errorf("could not validate token: %w", err)
	}
	claims := token.Claims.(jwt.MapClaims)
	return Claims(claims), nil
}

func NewJwksTokenDecoder(logger *zap.Logger, url string, refreshInterval time.Duration) (TokenDecoder, error) {

	jwks, err := keyfunc.Get(url, keyfunc.Options{
		RefreshInterval: refreshInterval,
		// Allow the JWKS to be empty initially, but it can recover on refresh.
		TolerateInitialJWKHTTPError: true,
		RefreshErrorHandler: func(err error) {
			logger.Error("Could not refresh JWKS. The JWKS will be empty until the next refresh.", zap.Error(err))
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error initializing JWKS from %q: %w", url, err)
	}

	return &jwksTokenDecoder{
		jwks: jwks,
	}, nil
}

func (j *jwksTokenDecoder) Close() {
	if j.jwks != nil {
		j.jwks.EndBackground()
	}
}
