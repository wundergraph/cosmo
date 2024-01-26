package core

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type CosmoAuthorizerOptions struct {
	FieldConfigurations []*nodev1.FieldConfiguration
}

func NewCosmoAuthorizer(opts *CosmoAuthorizerOptions) *CosmoAuthorizer {
	return &CosmoAuthorizer{
		FieldConfigurations: opts.FieldConfigurations,
	}
}

type CosmoAuthorizer struct {
	FieldConfigurations []*nodev1.FieldConfiguration
}

func (a *CosmoAuthorizer) getAuth(ctx context.Context) (isAuthenticated bool, scopes []string) {
	auth := authentication.FromContext(ctx)
	if auth == nil {
		return false, nil
	}
	return true, auth.Scopes()
}

func (a *CosmoAuthorizer) AuthorizePreFetch(ctx *resolve.Context, dataSourceID string, input json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.validateScopes(required, isAuthenticated, actual)
}

func (a *CosmoAuthorizer) AuthorizeObjectField(ctx *resolve.Context, dataSourceID string, object json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.validateScopes(required, isAuthenticated, actual)
}

func (a *CosmoAuthorizer) validateScopes(requiredOrScopes []*nodev1.Scopes, isAuthenticated bool, actual []string) (result *resolve.AuthorizationDeny, err error) {
	if !isAuthenticated {
		return &resolve.AuthorizationDeny{
			Reason: "not authenticated",
		}, nil
	}
	if len(requiredOrScopes) == 0 {
		return nil, nil
	}
WithNext:
	for _, requiredOrScope := range requiredOrScopes {
		for i := range requiredOrScope.RequiredAndScopes {
			if !slices.Contains(actual, requiredOrScope.RequiredAndScopes[i]) {
				continue WithNext
			}
		}
		return nil, nil
	}
	return &resolve.AuthorizationDeny{
		Reason: a.renderReason(requiredOrScopes, actual),
	}, nil
}

func (a *CosmoAuthorizer) renderReason(requiredOrScopes []*nodev1.Scopes, actual []string) string {
	builder := strings.Builder{}
	builder.WriteString("required scopes: ")
	for i := range requiredOrScopes {
		if i > 0 {
			builder.WriteString(" OR ")
		}
		builder.WriteString("(")
		for j := range requiredOrScopes[i].RequiredAndScopes {
			if j > 0 {
				builder.WriteString(" AND ")
			}
			builder.WriteString("'")
			builder.WriteString(requiredOrScopes[i].RequiredAndScopes[j])
			builder.WriteString("'")
		}
		builder.WriteString(")")
	}
	builder.WriteString(", actual scopes: ")
	if len(actual) == 0 {
		builder.WriteString("<none>")
	}
	for i := range actual {
		if i > 0 {
			builder.WriteString(", ")
		}
		builder.WriteString(actual[i])
	}
	return builder.String()
}

func (a *CosmoAuthorizer) requiredScopesForField(coordinate resolve.GraphCoordinate) []*nodev1.Scopes {
	for i := range a.FieldConfigurations {
		if a.FieldConfigurations[i].TypeName == coordinate.TypeName && a.FieldConfigurations[i].FieldName == coordinate.FieldName {
			return a.FieldConfigurations[i].AuthorizationConfiguration.RequiredOrScopes
		}
	}
	return nil
}
