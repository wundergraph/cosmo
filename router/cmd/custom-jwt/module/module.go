package module

import (
	"fmt"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

func init() {
	// Register your module here
	core.RegisterModule(&JWTModule{})
}

const (
	ModuleID        = "com.example.custom-jwt"
	tokenContextKey = "jwt-token"
)

// JWTModule is a module that signs outgoing requests with a JWT token
// based on the authentication information of the received request
type JWTModule struct {
	// Properties that are set by the config file are automatically populated based on the `mapstructure` tag
	// Create a new section under `modules.<name>` in the config file with the same name as your module.
	// Don't forget in Go the first letter of a property must be uppercase to be exported

	SecretKey string `mapstructure:"secret_key"`

	Logger *zap.Logger
}

func (m *JWTModule) Provision(ctx *core.ModuleContext) error {
	// Validate that the secret key was provided
	if m.SecretKey == "" {
		return fmt.Errorf("secret key cannot be empty")
	}

	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *JWTModule) Middleware(ctx core.RequestContext, next http.Handler) {
	// Check if the incoming request is authenticated. In that case, we
	// generate a new JWT with the shared secret key and add it to the
	// request context
	auth := ctx.Authentication()
	if auth != nil {
		claims := jwt.MapClaims(auth.Claims())
		if claims == nil {
			claims = make(jwt.MapClaims)
		}
		claims["iss"] = "cosmo-router"
		t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signed, err := t.SignedString([]byte(m.SecretKey))
		if err != nil {
			core.WriteResponseError(ctx, fmt.Errorf("error signing token: %w", err))
			return
		}
		ctx.Set(tokenContextKey, signed)
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *JWTModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	// Get the token, if any, from the request context and add it to the outgoing request
	if token := ctx.GetString(tokenContextKey); token != "" {
		request.Header.Add("Authorization", "Bearer "+token)
	}
	return request, nil
}

func (m *JWTModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: ModuleID,
		New: func() core.Module {
			return &JWTModule{}
		},
	}
}

var _ interface {
	core.EnginePreOriginHandler
	core.RouterMiddlewareHandler
	core.Provisioner
} = (*JWTModule)(nil)
