package main

import (
	"errors"
	"slices"

	"github.com/golang-jwt/jwt/v5"
)

const AudienceGraphKey = "cosmo:graph-key"

type GraphKeyClaims struct {
	jwt.RegisteredClaims

	FederatedGraphID string `json:"federated_graph_id"`
	OrganizationID   string `json:"organization_id"`
}

func (c *GraphKeyClaims) Validate() error {
	if !slices.Contains(c.Audience, AudienceGraphKey) {
		return errors.New("audience is not " + AudienceGraphKey)
	}

	if c.FederatedGraphID == "" {
		return errors.New("missing federated_graph_id claim")
	}

	if c.OrganizationID == "" {
		return errors.New("missing organization_id claim")
	}
	return nil
}
