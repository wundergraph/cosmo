package core

import (
	"context"
	"encoding/json"
	"io"
	"slices"
	"sync"

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

func (a *CosmoAuthorizer) HasResponseExtensionData(ctx *resolve.Context) bool {
	extension := a.getAuthorizationExtension(ctx)
	return extension != nil && len(extension.MissingScopes) > 0
}

func (a *CosmoAuthorizer) RenderResponseExtension(ctx *resolve.Context, out io.Writer) error {
	extension := a.getAuthorizationExtension(ctx)
	if extension == nil {
		return nil
	}
	data, err := json.Marshal(extension)
	if err != nil {
		return err
	}
	_, err = out.Write(data)
	return err
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
	return a.handleRejectUnauthorized(a.validateScopes(ctx, coordinate, required, isAuthenticated, actual))
}

func (a *CosmoAuthorizer) AuthorizeObjectField(ctx *resolve.Context, dataSourceID string, object json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.handleRejectUnauthorized(a.validateScopes(ctx, coordinate, required, isAuthenticated, actual))
}

func (a *CosmoAuthorizer) validateScopes(ctx *resolve.Context, coordinate resolve.GraphCoordinate, requiredOrScopes []*nodev1.Scopes, isAuthenticated bool, actual []string) (result *resolve.AuthorizationDeny) {
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
	a.addMissingScopes(ctx, coordinate, requiredOrScopes, actual)
	return &resolve.AuthorizationDeny{
		Reason: "missing required scopes",
	}
}

func (a *CosmoAuthorizer) addMissingScopes(ctx *resolve.Context, coordinate resolve.GraphCoordinate, requiredOrScopes []*nodev1.Scopes, actual []string) {
	extensionCtx := ctx.Context().Value(authorizationExtensionKey{})
	if extensionCtx == nil {
		return
	}
	extension := extensionCtx.(*authorizationExtensionCtx)
	extension.mux.Lock()
	if extension.extension.ActualScopes == nil {
		if len(actual) == 0 {
			extension.extension.ActualScopes = make([]string, 0)
		} else {
			extension.extension.ActualScopes = actual
		}
	}
	extension.extension.MissingScopes = append(extension.extension.MissingScopes, a.missingScopesError(coordinate, requiredOrScopes))
	extension.mux.Unlock()
}

func (a *CosmoAuthorizer) getAuthorizationExtension(ctx *resolve.Context) *AuthorizationExtension {
	extensionCtx := ctx.Context().Value(authorizationExtensionKey{})
	if extensionCtx == nil {
		return nil
	}
	extension := extensionCtx.(*authorizationExtensionCtx)
	return &extension.extension
}

type authorizationExtensionCtx struct {
	extension AuthorizationExtension
	mux       sync.Mutex
}

type authorizationExtensionKey struct{}

func WithAuthorizationExtension(ctx *resolve.Context) *resolve.Context {
	withAuthorization := context.WithValue(ctx.Context(), authorizationExtensionKey{}, &authorizationExtensionCtx{})
	return ctx.WithContext(withAuthorization)
}

type AuthorizationExtension struct {
	MissingScopes []MissingScopesError `json:"missingScopes,omitempty"`
	ActualScopes  []string             `json:"actualScopes"`
}

type MissingScopesError struct {
	Coordinate       resolve.GraphCoordinate `json:"coordinate"`
	RequiredOrScopes [][]string              `json:"required"`
}

type RequiredAndScopes struct {
	RequiredAndScopes []string `json:"and"`
}

func (a *CosmoAuthorizer) missingScopesError(coordinate resolve.GraphCoordinate, requiredOrScopes []*nodev1.Scopes) MissingScopesError {
	out := MissingScopesError{
		Coordinate:       coordinate,
		RequiredOrScopes: a.requiredAndScopes(requiredOrScopes),
	}
	return out
}

func (a *CosmoAuthorizer) requiredAndScopes(requiredOrScopes []*nodev1.Scopes) [][]string {
	var result [][]string
	for i := range requiredOrScopes {
		result = append(result, requiredOrScopes[i].RequiredAndScopes)
	}
	return result
}

func (a *CosmoAuthorizer) requiredScopesForField(coordinate resolve.GraphCoordinate) []*nodev1.Scopes {
	for i := range a.fieldConfigurations {
		if a.fieldConfigurations[i].TypeName == coordinate.TypeName && a.fieldConfigurations[i].FieldName == coordinate.FieldName {
			return a.fieldConfigurations[i].AuthorizationConfiguration.RequiredOrScopes
		}
	}
	return nil
}
