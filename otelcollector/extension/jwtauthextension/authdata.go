package jwtauthextension

import (
	"github.com/golang-jwt/jwt/v5"
	"go.opentelemetry.io/collector/client"
)

var _ client.AuthData = (*authData)(nil)

// authData exposes the JWT claims to processors, e.g. `from_context: auth.organization_id`.
type authData struct {
	jwtClaims jwt.MapClaims
}

func (a *authData) GetAttribute(name string) any {
	if val, ok := a.jwtClaims[name]; ok {
		return val
	}
	return nil
}

func (a *authData) GetAttributeNames() []string {
	keys := make([]string, 0, len(a.jwtClaims))
	for k := range a.jwtClaims {
		keys = append(keys, k)
	}
	return keys
}
