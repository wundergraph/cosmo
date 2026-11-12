package core

import (
	"context"
	"encoding/json"
	"io"
	"slices"
	"sync"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// CosmoAuthorizerOptions configures a CosmoAuthorizer.
type CosmoAuthorizerOptions struct {
	// FieldConfigurations holds the per-field authorization rules from the engine config.
	FieldConfigurations []*nodev1.FieldConfiguration
	// RejectOperationIfUnauthorized rejects the whole operation when a field fails to authorize,
	// instead of only filtering the unauthorized field out of the response.
	RejectOperationIfUnauthorized bool
	// EnablePreFetchFieldAuthorization authorizes protected fields in a single batch before any
	// subgraph fetch runs, instead of filtering them out of the response afterwards.
	EnablePreFetchFieldAuthorization bool
	PolicyDecider                    PolicyDecider
}

func NewCosmoAuthorizer(opts *CosmoAuthorizerOptions) *CosmoAuthorizer {
	return &CosmoAuthorizer{
		fieldConfigurations:              opts.FieldConfigurations,
		rejectUnauthorized:               opts.RejectOperationIfUnauthorized,
		enablePreFetchFieldAuthorization: opts.EnablePreFetchFieldAuthorization,
		policyDecider:                    opts.PolicyDecider,
	}
}

// CosmoAuthorizer enforces field-level authorization (@authenticated, @requiresScopes and @policy). It checks
// scopes against the scopes of the authenticated request, and policies against the policies that the policy
// decider granted. It implements resolve.Authorizer and, when pre-fetch field authorization is enabled,
// resolve.BatchAuthorizer.
type CosmoAuthorizer struct {
	fieldConfigurations              []*nodev1.FieldConfiguration
	rejectUnauthorized               bool
	enablePreFetchFieldAuthorization bool
	policyDecider                    PolicyDecider
}

// IsPreFetchFieldAuthorizationEnabled reports whether the engine should authorize protected fields
// up front in one batch call rather than filtering them out of the response after the fetch.
func (a *CosmoAuthorizer) IsPreFetchFieldAuthorizationEnabled() bool {
	return a.enablePreFetchFieldAuthorization
}

// HasResponseExtensionData reports whether any missing scopes were collected during resolution and
// should be rendered into the response extensions.
func (a *CosmoAuthorizer) HasResponseExtensionData(ctx *resolve.Context) bool {
	extension := a.getAuthorizationExtension(ctx)
	return extension != nil && (len(extension.MissingScopes) > 0 || len(extension.MissingPolicies) > 0)
}

// RenderResponseExtension writes the collected authorization extension (missing and actual scopes)
// as JSON. It writes nothing when no extension context is attached to ctx.
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

// getAuth reads the authentication attached to the request context, returning whether the request
// is authenticated and its scopes.
func (a *CosmoAuthorizer) getAuth(ctx context.Context) (isAuthenticated bool, scopes []string) {
	auth := authentication.FromContext(ctx)
	if auth == nil {
		return false, nil
	}
	return true, auth.Scopes()
}

// handleRejectUnauthorized turns a deny into a hard ErrUnauthorized when reject mode is on, so the
// whole operation fails instead of only the unauthorized field being filtered out. A nil result
// (authorized) passes through unchanged.
func (a *CosmoAuthorizer) handleRejectUnauthorized(result *resolve.AuthorizationDeny) (*resolve.AuthorizationDeny, error) {
	if result == nil {
		return nil, nil
	}
	if a.rejectUnauthorized {
		return nil, ErrUnauthorized
	}
	return result, nil
}

// AuthorizePreFetch authorizes a field before its subgraph fetch runs. A deny prevents the fetch,
// which matters for mutations where filtering the response afterwards would not stop the write.
func (a *CosmoAuthorizer) AuthorizePreFetch(ctx *resolve.Context, dataSourceID string, input json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.handleRejectUnauthorized(a.validateAuthorization(ctx, coordinate, required, isAuthenticated, actual))
}

// AuthorizeObjectField authorizes a field against the already-fetched response object. A deny filters
// the field out of the response but cannot prevent the fetch.
func (a *CosmoAuthorizer) AuthorizeObjectField(ctx *resolve.Context, dataSourceID string, object json.RawMessage, coordinate resolve.GraphCoordinate) (result *resolve.AuthorizationDeny, err error) {
	isAuthenticated, actual := a.getAuth(ctx.Context())
	required := a.requiredScopesForField(coordinate)
	return a.handleRejectUnauthorized(a.validateAuthorization(ctx, coordinate, required, isAuthenticated, actual))
}

// AuthorizeFields authorizes every protected field coordinate of an operation in one call, before any
// fetch runs. It backs pre-fetch field authorization and returns one decision per coordinate, in the
// same order. It implements [resolve.BatchAuthorizer].
func (a *CosmoAuthorizer) AuthorizeFields(ctx *resolve.Context, coordinates []resolve.GraphCoordinate) ([]resolve.AuthorizationDecision, error) {
	decisions := make([]resolve.AuthorizationDecision, len(coordinates))
	isAuthenticated, actual := a.getAuth(ctx.Context())

	for i, coordinate := range coordinates {
		required := a.requiredScopesForField(coordinate)
		deny, err := a.handleRejectUnauthorized(a.validateAuthorization(ctx, coordinate, required, isAuthenticated, actual))
		if err != nil {
			return nil, err
		}

		if deny != nil {
			decisions[i] = resolve.AuthorizationDecision{
				Allowed: false,
				Reason:  deny.Reason,
			}
			continue
		}

		decisions[i] = resolve.AuthorizationDecision{
			Allowed: true,
		}
	}

	return decisions, nil
}

// validateAuthorization checks the policies of a field first, then its authentication and its scopes.
// Policy grants do not imply authentication, so a field with policies only skips the authentication check.
func (a *CosmoAuthorizer) validateAuthorization(ctx *resolve.Context, coordinate resolve.GraphCoordinate, requiredOrScopes []*nodev1.Scopes, isAuthenticated bool, actual []string) *resolve.AuthorizationDeny {
	authorization := a.authorizationForField(coordinate)
	requiredOrPolicies := authorization.GetRequiredOrPolicies()
	if len(requiredOrPolicies) > 0 {
		if deny := a.validatePolicies(ctx, coordinate, requiredOrPolicies, actual); deny != nil {
			return deny
		}
		if len(requiredOrScopes) == 0 && !authorization.GetRequiresAuthentication() {
			return nil
		}
	}
	return a.validateScopes(ctx, coordinate, requiredOrScopes, isAuthenticated, actual)
}

// validatePolicies checks the policies that the policy decider granted against a field's required
// policies, an OR of ANDs like the required scopes. Denials are recorded via addPolicyDenial.
func (a *CosmoAuthorizer) validatePolicies(ctx *resolve.Context, coordinate resolve.GraphCoordinate, requiredOrPolicies []*nodev1.Policies, actual []string) *resolve.AuthorizationDeny {
	granted, _ := ctx.Context().Value(grantedPoliciesKey{}).([]string)
	required := make([][]string, 0, len(requiredOrPolicies))
	for _, group := range requiredOrPolicies {
		required = append(required, group.GetRequiredAndPolicies())
	}
	if a.satisfiesAnyGroup(required, granted) {
		return nil
	}
	a.addPolicyDenial(ctx, coordinate, required, granted, actual)
	return &resolve.AuthorizationDeny{
		Reason: "missing policies",
	}
}

// validateScopes checks the actual scopes against a field's required scopes. requiredOrScopes is a
// disjunction: the field is authorized if all scopes of any one entry are present (OR of ANDs). An
// unauthenticated request is always denied; a field with no required scopes is allowed. Denials are
// recorded via addMissingScopes.
func (a *CosmoAuthorizer) validateScopes(ctx *resolve.Context, coordinate resolve.GraphCoordinate, requiredOrScopes []*nodev1.Scopes, isAuthenticated bool, actual []string) (result *resolve.AuthorizationDeny) {
	if !isAuthenticated {
		return &resolve.AuthorizationDeny{
			Reason: "not authenticated",
		}
	}
	if len(requiredOrScopes) == 0 {
		return nil
	}
	if a.satisfiesAnyGroup(a.requiredAndScopes(requiredOrScopes), actual) {
		return nil
	}
	a.addMissingScopes(ctx, coordinate, requiredOrScopes, actual)
	return &resolve.AuthorizationDeny{
		Reason: "missing required scopes",
	}
}

// addMissingScopes records a denied field and the request's actual scopes on the authorization
// extension context, deduplicating by coordinate. It is a no-op when no extension context is attached.
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
	newMissingScopesError := a.missingScopesError(coordinate, requiredOrScopes)
	if !slices.ContainsFunc(extension.extension.MissingScopes, func(existingMissingScopesError MissingScopesError) bool {
		return existingMissingScopesError.Coordinate.TypeName == newMissingScopesError.Coordinate.TypeName &&
			existingMissingScopesError.Coordinate.FieldName == newMissingScopesError.Coordinate.FieldName
	}) {
		extension.extension.MissingScopes = append(extension.extension.MissingScopes, newMissingScopesError)
	}
	extension.mux.Unlock()
}

// addPolicyDenial records a field that its policies denied, the granted policies and the request's actual
// scopes on the authorization extension context, deduplicating by coordinate. It is a no-op when no
// extension context is attached.
func (a *CosmoAuthorizer) addPolicyDenial(ctx *resolve.Context, coordinate resolve.GraphCoordinate, required [][]string, granted, actual []string) {
	extensionCtx := ctx.Context().Value(authorizationExtensionKey{})
	if extensionCtx == nil {
		return
	}
	extension := extensionCtx.(*authorizationExtensionCtx)
	extension.mux.Lock()
	defer extension.mux.Unlock()
	if extension.extension.ActualScopes == nil {
		extension.extension.ActualScopes = actual
		if len(actual) == 0 {
			extension.extension.ActualScopes = []string{}
		}
	}
	if extension.extension.GrantedPolicies == nil {
		extension.extension.GrantedPolicies = slices.Clone(granted)
	}
	// The loader and the resolvable report the same field with different HasAuthorizationRule flags,
	// so the comparison takes the type and the field only.
	if slices.ContainsFunc(extension.extension.MissingPolicies, func(existing MissingPoliciesError) bool {
		return existing.Coordinate.TypeName == coordinate.TypeName && existing.Coordinate.FieldName == coordinate.FieldName
	}) {
		return
	}
	extension.extension.MissingPolicies = append(extension.extension.MissingPolicies, MissingPoliciesError{
		Coordinate:         coordinate,
		RequiredOrPolicies: required,
	})
}

// getAuthorizationExtension returns the authorization extension accumulated on the context, or nil if
// none was attached via WithAuthorizationExtension.
func (a *CosmoAuthorizer) getAuthorizationExtension(ctx *resolve.Context) *AuthorizationExtension {
	extensionCtx := ctx.Context().Value(authorizationExtensionKey{})
	if extensionCtx == nil {
		return nil
	}
	extension := extensionCtx.(*authorizationExtensionCtx)
	return &extension.extension
}

// authorizationExtensionCtx accumulates authorization results for a single request. The mutex guards
// against concurrent writes from fetches that run in parallel.
type authorizationExtensionCtx struct {
	extension AuthorizationExtension
	mux       sync.Mutex
}

type authorizationExtensionKey struct{}

// WithAuthorizationExtension attaches a fresh authorization accumulator to the context so denied
// fields and scopes can be collected during resolution and later rendered into the response.
func WithAuthorizationExtension(ctx *resolve.Context) *resolve.Context {
	withAuthorization := context.WithValue(ctx.Context(), authorizationExtensionKey{}, &authorizationExtensionCtx{})
	return ctx.WithContext(withAuthorization)
}

// AuthorizationExtension is the authorization payload rendered into the response extensions.
type AuthorizationExtension struct {
	MissingScopes []MissingScopesError `json:"missingScopes,omitempty"`
	ActualScopes  []string             `json:"actualScopes"`
	// MissingPolicies lists the fields that their policies denied.
	MissingPolicies []MissingPoliciesError `json:"missingPolicies,omitempty"`
	// GrantedPolicies lists the policies that the policy decider granted to the request.
	// It is omitted when the decider granted no policy.
	GrantedPolicies []string `json:"grantedPolicies,omitempty"`
}

// MissingPoliciesError reports a field that was denied and the policies it required (an OR of ANDs).
type MissingPoliciesError struct {
	Coordinate         resolve.GraphCoordinate `json:"coordinate"`
	RequiredOrPolicies [][]string              `json:"required"`
}

// MissingScopesError reports a field that was denied and the scopes it required (an OR of ANDs).
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

// requiredAndScopes flattens the proto scopes into the [][]string OR-of-ANDs shape used in responses.
func (a *CosmoAuthorizer) requiredAndScopes(requiredOrScopes []*nodev1.Scopes) [][]string {
	var result [][]string
	for i := range requiredOrScopes {
		result = append(result, requiredOrScopes[i].RequiredAndScopes)
	}
	return result
}

// requiredScopesForField returns the required-or-scopes configured for a field coordinate, or nil when
// the field has no authorization configuration.
func (a *CosmoAuthorizer) requiredScopesForField(coordinate resolve.GraphCoordinate) []*nodev1.Scopes {
	return a.authorizationForField(coordinate).GetRequiredOrScopes()
}

func (a *CosmoAuthorizer) requiredPoliciesForField(coordinate resolve.GraphCoordinate) []*nodev1.Policies {
	return a.authorizationForField(coordinate).GetRequiredOrPolicies()
}

func (a *CosmoAuthorizer) authorizationForField(coordinate resolve.GraphCoordinate) *nodev1.AuthorizationConfiguration {
	for i := range a.fieldConfigurations {
		if a.fieldConfigurations[i].TypeName == coordinate.TypeName && a.fieldConfigurations[i].FieldName == coordinate.FieldName {
			return a.fieldConfigurations[i].AuthorizationConfiguration
		}
	}
	return nil
}

// satisfiesAnyGroup reports whether actual holds all values of at least one group of required (OR of ANDs).
func (a *CosmoAuthorizer) satisfiesAnyGroup(required [][]string, actual []string) bool {
next:
	for _, group := range required {
		for _, value := range group {
			if !slices.Contains(actual, value) {
				continue next
			}
		}
		return true
	}
	return false
}

// firstPolicyField returns the first field configuration that carries a policy, or nil.
func firstPolicyField(fields []*nodev1.FieldConfiguration) *nodev1.FieldConfiguration {
	for _, field := range fields {
		if len(field.GetAuthorizationConfiguration().GetRequiredOrPolicies()) > 0 {
			return field
		}
	}
	return nil
}

type grantedPoliciesKey struct{}

// decidePolicies asks the policy decider once for all policies of the operation and stores the
// granted policies on the returned context, where the per-field checks read them.
func (a *CosmoAuthorizer) decidePolicies(ctx context.Context, prepared plan.Plan) (context.Context, error) {
	var info *resolve.GraphQLResponseInfo
	switch p := prepared.(type) {
	case *plan.SynchronousResponsePlan:
		info = p.Response.Info
	case *plan.SubscriptionResponsePlan:
		info = p.Response.Response.Info
	case *plan.DeferResponsePlan:
		info = p.Response.Response.Info
	}
	var required []string
	if info != nil {
		for _, coordinate := range info.AuthorizationCoordinates {
			for _, group := range a.requiredPoliciesForField(coordinate.Coordinate) {
				required = append(required, group.GetRequiredAndPolicies()...)
			}
		}
	}
	slices.Sort(required)
	required = slices.Compact(required)
	var granted []string
	if len(required) > 0 && a.policyDecider != nil {
		var err error
		granted, err = a.policyDecider.Decide(ctx, required)
		if err != nil {
			return ctx, err
		}
	}
	return context.WithValue(ctx, grantedPoliciesKey{}, slices.Clone(granted)), nil
}
