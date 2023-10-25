package module

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

func init() {
	// Register your module here
	core.RegisterModule(&JWTModule{})
}

const ModuleID = "com.example.custom-jwt"

// JWTModule is a module that signs outgoing requests with a JWT token
// based on the authentication information of the received request
type JWTModule struct {
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

func (m *JWTModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	// Check if the incoming request is authenticated. In that case, we
	// generate a new JWT with the shared secret key and add it to the
	// outgoing request.
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
			return nil, &http.Response{
				StatusCode: http.StatusInternalServerError,
				Body:       io.NopCloser(strings.NewReader(fmt.Sprintf("signing token: %s", err))),
			}
		}
		request.Header.Add("Authorization", "Bearer "+signed)
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

var (
	_ core.EnginePreOriginHandler = (*JWTModule)(nil)
	_ core.Provisioner            = (*JWTModule)(nil)
)
