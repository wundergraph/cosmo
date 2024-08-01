package claims

import (
	"context"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

type GraphAPITokenClaims struct {
	OrganizationID   string `json:"organization_id"`
	FederatedGraphID string `json:"federated_graph_id"`
	jwt.RegisteredClaims
}

type claimsContextKey string

const claimsKey claimsContextKey = "claims"

func GetClaims(ctx context.Context) (*GraphAPITokenClaims, error) {
	claims, ok := ctx.Value(claimsKey).(*GraphAPITokenClaims)
	if !ok {
		return nil, fmt.Errorf("could not get claims from context")
	}
	return claims, nil
}

func SetClaims(ctx context.Context, claims *GraphAPITokenClaims) context.Context {
	return context.WithValue(ctx, claimsKey, claims)
}
