package jwtauthextension

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"go.uber.org/zap"
)

var (
	errInvalidAuthenticationHeaderFormat = errors.New("invalid authorization header format")
	errNotAuthenticated                  = errors.New("authentication didn't succeed")
)

var _ extensionauth.Server = (*jwtExtension)(nil)

type jwtExtension struct {
	attribute string
	jwtSecret []byte
	logger    *zap.Logger
}

func newExtension(cfg *Config, logger *zap.Logger) (*jwtExtension, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	attribute := cfg.Attribute
	if attribute == "" {
		attribute = defaultAttribute
	}

	return &jwtExtension{
		attribute: attribute,
		jwtSecret: []byte(cfg.JWTSecret),
		logger:    logger,
	}, nil
}

func (*jwtExtension) Start(context.Context, component.Host) error {
	return nil
}

func (*jwtExtension) Shutdown(context.Context) error {
	return nil
}

// Authenticate validates the bearer token from the configured header. On success, the returned
// context carries the token claims as client auth data.
func (e *jwtExtension) Authenticate(ctx context.Context, headers map[string][]string) (context.Context, error) {
	// client.Metadata lookups are case-insensitive.
	authHeaders := client.NewMetadata(headers).Get(e.attribute)
	if len(authHeaders) == 0 {
		return ctx, errNotAuthenticated
	}

	// Only the first header is used if multiple values exist.
	scheme, rawToken, ok := strings.Cut(authHeaders[0], " ")
	if !ok || scheme == "" || rawToken == "" || strings.Contains(rawToken, " ") {
		return ctx, errInvalidAuthenticationHeaderFormat
	}

	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return e.jwtSecret, nil
	})
	if err != nil {
		return ctx, fmt.Errorf("failed to parse token: %w", err)
	}

	cl := client.FromContext(ctx)
	cl.Auth = &authData{jwtClaims: claims}
	return client.NewContext(ctx, cl), nil
}
