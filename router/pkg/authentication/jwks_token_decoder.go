package authentication

import (
	"fmt"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
)

type tokenDecoder interface {
	Decode(token string) (Claims, error)
}

type jwksTokenDecoder struct {
	// JSON Web Key Set, automatically updated in the background
	// by keyfunc.
	jwks *keyfunc.JWKS
}

// Decode implements tokenDecoder.
func (j *jwksTokenDecoder) Decode(tokenString string) (Claims, error) {
	token, err := jwt.Parse(tokenString, j.jwks.Keyfunc)
	if err != nil {
		return nil, fmt.Errorf("could not validate token: %w", err)
	}
	claims := token.Claims.(jwt.MapClaims)
	return Claims(claims), nil
}

func NewJwksTokenDecoder(url string, refreshInterval time.Duration) (tokenDecoder, error) {

	jwks, err := keyfunc.Get(url, keyfunc.Options{
		RefreshInterval: refreshInterval,
	})
	if err != nil {
		return nil, fmt.Errorf("error initializing JWKS from %q: %w", url, err)
	}

	return &jwksTokenDecoder{
		jwks: jwks,
	}, nil
}
