package jwt

import (
	"fmt"
	"github.com/golang-jwt/jwt/v5"
)

const (
	FederatedGraphIDClaim = "federated_graph_id"
	OrganizationIDClaim   = "organization_id"
)

type FederatedGraphTokenClaims struct {
	FederatedGraphID string
	OrganizationID   string
}

func ExtractFederatedGraphTokenClaims(token string) (*FederatedGraphTokenClaims, error) {
	jwtParser := new(jwt.Parser)
	claims := make(jwt.MapClaims)

	_, _, err := jwtParser.ParseUnverified(token, claims)
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	federatedGraphIDValue := claims[FederatedGraphIDClaim]
	if federatedGraphIDValue == nil {
		return nil, fmt.Errorf("invalid token claims, missing %q", FederatedGraphIDClaim)
	}

	federatedGraphID, ok := federatedGraphIDValue.(string)
	if !ok {
		return nil, fmt.Errorf("invalid token claims, %q is not a string, it's %T", FederatedGraphIDClaim, federatedGraphIDValue)
	}

	organizationIDValue := claims[OrganizationIDClaim]
	if organizationIDValue == nil {
		return nil, fmt.Errorf("invalid token claims, missing %q", OrganizationIDClaim)
	}

	organizationID, ok := organizationIDValue.(string)
	if !ok {
		return nil, fmt.Errorf("invalid token claims, %q is not a string, it's %T", OrganizationIDClaim, organizationIDValue)
	}

	return &FederatedGraphTokenClaims{
		FederatedGraphID: federatedGraphID,
		OrganizationID:   organizationID,
	}, nil
}
