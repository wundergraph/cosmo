package core

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestPolicyAuthorization(t *testing.T) {
	for _, tt := range []struct {
		name                   string
		granted                []string
		authenticated          bool
		requiresAuthentication bool
		reject                 bool
		reason                 string
	}{
		{
			name:   "missing decider denies",
			reason: "missing policies",
		},
		{
			name:    "partial AND denies",
			granted: []string{"a"},
			reason:  "missing policies",
		},
		{
			name:    "AND grants without authentication",
			granted: []string{"a", "b"},
		},
		{
			name:    "OR grants without authentication",
			granted: []string{"c"},
		},
		{
			name:                   "explicit authentication remains required",
			granted:                []string{"c"},
			requiresAuthentication: true,
			reason:                 "not authenticated",
		},
		{
			name:          "authentication does not grant policies",
			authenticated: true,
			reason:        "missing policies",
		},
		{
			name:   "reject mode",
			reject: true,
			reason: "missing policies",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &nodev1.FieldConfiguration{
				TypeName:  "Query",
				FieldName: "secret",
				AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
					RequiresAuthentication: tt.requiresAuthentication,
					RequiredOrPolicies: []*nodev1.Policies{
						{
							RequiredAndPolicies: []string{"a", "b"},
						},
						{
							RequiredAndPolicies: []string{"c"},
						},
					},
				},
			}
			a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
				FieldConfigurations:           []*nodev1.FieldConfiguration{cfg},
				RejectOperationIfUnauthorized: tt.reject,
			})
			ctx := resolveContext(tt.authenticated)
			ctx = ctx.WithContext(context.WithValue(ctx.Context(), grantedPoliciesKey{}, tt.granted))
			ctx = WithAuthorizationExtension(ctx)
			coord := coordinate("Query", "secret")
			for _, authorize := range []func() (*resolve.AuthorizationDeny, error){
				func() (*resolve.AuthorizationDeny, error) { return a.AuthorizePreFetch(ctx, "", nil, coord) },
				func() (*resolve.AuthorizationDeny, error) { return a.AuthorizeObjectField(ctx, "", nil, coord) },
			} {
				deny, err := authorize()
				if tt.reject {
					require.ErrorIs(t, err, ErrUnauthorized)
				} else {
					require.NoError(t, err)
					if tt.reason == "" {
						require.Nil(t, deny)
					} else {
						require.Equal(t, tt.reason, deny.Reason)
					}
				}
			}
			decisions, err := a.AuthorizeFields(ctx, []resolve.GraphCoordinate{coord})
			if tt.reject {
				require.ErrorIs(t, err, ErrUnauthorized)
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.reason == "", decisions[0].Allowed)
				require.Equal(t, tt.reason, decisions[0].Reason)
			}
			if tt.reason != "missing policies" {
				require.False(t, a.HasResponseExtensionData(ctx))
				return
			}
			require.True(t, a.HasResponseExtensionData(ctx))
			var out bytes.Buffer
			require.NoError(t, a.RenderResponseExtension(ctx, &out))
			expected := `{
				"actualScopes": [],
				"missingPolicies": [
					{
						"coordinate": {"typeName": "Query", "fieldName": "secret"},
						"required": [["a", "b"], ["c"]]
					}
				]
			}`
			if len(tt.granted) > 0 {
				expected = `{
					"actualScopes": [],
					"missingPolicies": [
						{
							"coordinate": {"typeName": "Query", "fieldName": "secret"},
							"required": [["a", "b"], ["c"]]
						}
					],
					"grantedPolicies": ["a"]
				}`
			}
			var compact bytes.Buffer
			require.NoError(t, json.Compact(&compact, []byte(expected)))
			require.Equal(t, compact.String(), out.String())
		})
	}
}

// A field with both directives needs the policy and the scope; the policy is checked first.
func TestPolicyWithScopes(t *testing.T) {
	a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
		FieldConfigurations: []*nodev1.FieldConfiguration{
			{
				TypeName:  "Query",
				FieldName: "secret",
				AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
					RequiredOrPolicies: []*nodev1.Policies{
						{
							RequiredAndPolicies: []string{"p"},
						},
					},
					RequiredOrScopes: []*nodev1.Scopes{
						{
							RequiredAndScopes: []string{"s"},
						},
					},
				},
			},
		},
	})
	for _, tt := range []struct {
		name    string
		granted []string
		scopes  []string
		reason  string
	}{
		{
			name:    "both present",
			granted: []string{"p"},
			scopes:  []string{"s"},
		},
		{
			name:    "scope missing",
			granted: []string{"p"},
			scopes:  []string{"other"},
			reason:  "missing required scopes",
		},
		{
			name:   "policy missing",
			scopes: []string{"s"},
			reason: "missing policies",
		},
		{
			name:   "both missing",
			reason: "missing policies",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx := resolveContext(true, tt.scopes...)
			ctx = ctx.WithContext(context.WithValue(ctx.Context(), grantedPoliciesKey{}, tt.granted))
			deny, err := a.AuthorizeObjectField(ctx, "", nil, coordinate("Query", "secret"))
			require.NoError(t, err)
			if tt.reason == "" {
				require.Nil(t, deny)
				return
			}
			require.Equal(t, tt.reason, deny.Reason)
		})
	}
}
