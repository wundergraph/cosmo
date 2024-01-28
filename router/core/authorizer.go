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
	FieldConfigurations           []*nodev1.FieldConfiguration
	RejectOperationIfUnauthorized bool
}

func NewCosmoAuthorizer(opts *CosmoAuthorizerOptions) *CosmoAuthorizer {
	return &CosmoAuthorizer{
		fieldConfigurations: opts.FieldConfigurations,
		rejectUnauthorized:  opts.RejectOperationIfUnauthorized,
	}
}

type CosmoAuthorizer struct {
	fieldConfigurations []*nodev1.FieldConfiguration
	rejectUnauthorized  bool
}

func (a *CosmoAuthorizer) getAuth(ctx context.Context) (isAuthenticated bool, scopes []string) {
	auth := authentication.FromContext(ctx)
	if auth == nil {
		return false, nil
	}
	return true, auth.Scopes()
}

func (a *CosmoAuthorizer) handleRejectUnauthorized(result *resolve.AuthorizationDeny) (*resolve.AuthorizationDeny, error) {
	if result == nil {
		return nil, nil
	}
	if a.rejectUnauthorized {
		return nil, ErrUnauthorized
	}
	return result, nil
}

func (a *CosmoAuthorizer) AuthorizePreFetch(ctx *resolve.Context, dataSourceID string, input json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.handleRejectUnauthorized(a.validateScopes(required, isAuthenticated, actual))
}

func (a *CosmoAuthorizer) AuthorizeObjectField(ctx *resolve.Context, dataSourceID string, object json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.handleRejectUnauthorized(a.validateScopes(required, isAuthenticated, actual))
}

func (a *CosmoAuthorizer) validateScopes(requiredOrScopes []*nodev1.Scopes, isAuthenticated bool, actual []string) (result *resolve.AuthorizationDeny) {
	if !isAuthenticated {
		return &resolve.AuthorizationDeny{
			Reason: "not authenticated",
		}
	}
	if len(requiredOrScopes) == 0 {
		return nil
	}
WithNext:
	for _, requiredOrScope := range requiredOrScopes {
		for i := range requiredOrScope.RequiredAndScopes {
			if !slices.Contains(actual, requiredOrScope.RequiredAndScopes[i]) {
				continue WithNext
			}
		}
		return nil
	}
	return &resolve.AuthorizationDeny{
		Reason: a.renderReason(requiredOrScopes, actual),
	}
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
	for i := range a.fieldConfigurations {
		if a.fieldConfigurations[i].TypeName == coordinate.TypeName && a.fieldConfigurations[i].FieldName == coordinate.FieldName {
			return a.fieldConfigurations[i].AuthorizationConfiguration.RequiredOrScopes
		}
	}
	return nil
}
