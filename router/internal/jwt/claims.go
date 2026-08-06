package jwt

import (
	"fmt"
	"slices"

	"github.com/golang-jwt/jwt/v5"
)

const (
	FederatedGraphIDClaim     = "federated_graph_id"
	OrganizationIDClaim       = "organization_id"
	FeaturesClaim             = "features"
	FeatureSplitConfigLoading = "split-config-loading"
)

type FederatedGraphTokenClaims struct {
	FederatedGraphID string
	OrganizationID   string
	Features         []string
}

// HasFeature reports whether the given feature flag is present in the token claims.
func (c *FederatedGraphTokenClaims) HasFeature(feature string) bool {
	return slices.Contains(c.Features, feature)
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

	var features []string
	if featuresValue := claims[FeaturesClaim]; featuresValue != nil {
		featuresSlice, ok := featuresValue.([]any)
		if !ok {
			return nil, fmt.Errorf("invalid token claims, %q is not an array, it's %T", FeaturesClaim, featuresValue)
		}
		for _, v := range featuresSlice {
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("invalid token claims, %q contains a non-string element %T", FeaturesClaim, v)
			}
			features = append(features, s)
		}
	}

	return &FederatedGraphTokenClaims{
		FederatedGraphID: federatedGraphID,
		OrganizationID:   organizationID,
		Features:         features,
	}, nil
}
