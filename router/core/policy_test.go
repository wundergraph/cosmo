package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// policyFieldConfig builds a FieldConfiguration for a coordinate whose authorization requires the given
// OR-of-ANDs policies. Each inner slice is an AND group; the field is authorized if any group matches.
func policyFieldConfig(typeName, fieldName string, requiredOrPolicies ...[]string) *nodev1.FieldConfiguration {
	orPolicies := make([]*nodev1.Policies, 0, len(requiredOrPolicies))
	for _, and := range requiredOrPolicies {
		orPolicies = append(orPolicies, &nodev1.Policies{RequiredAndPolicies: and})
	}
	return &nodev1.FieldConfiguration{
		TypeName:  typeName,
		FieldName: fieldName,
		AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
			RequiredOrPolicies: orPolicies,
		},
	}
}

// policyContext builds a resolve.Context like resolveContext and stores the granted policies on it, as
// decidePolicies does for an operation.
func policyContext(granted []string, authenticated bool, scopes ...string) *resolve.Context {
	ctx := resolveContext(authenticated, scopes...)
	return ctx.WithContext(context.WithValue(ctx.Context(), grantedPoliciesKey{}, granted))
}

// recordingPolicyDecider grants the policy "a" and records how often and with which policies it was asked.
type recordingPolicyDecider struct {
	calls    int
	required []string
	err      error
}

func (d *recordingPolicyDecider) Decide(ctx context.Context, required []string) ([]string, error) {
	d.calls++
	d.required = required
	return []string{"a"}, d.err
}

func TestCosmoAuthorizer_Policies(t *testing.T) {
	t.Parallel()

	missingPolicies := &resolve.AuthorizationDeny{
		Reason: "missing policies",
	}

	t.Run("object field authorization", func(t *testing.T) {
		t.Parallel()

		for _, tt := range []struct {
			name                   string
			granted                []string
			authenticated          bool
			requiresAuthentication bool
			deny                   *resolve.AuthorizationDeny
			extension              string
		}{
			{
				name: "denies without granted policies",
				deny: missingPolicies,
				extension: `
					{
						"actualScopes": [],
						"missingPolicies": [
							{
								"coordinate": {"typeName": "Query", "fieldName": "secret"},
								"required": [["a", "b"], ["c"]]
							}
						]
					}`,
			},
			{
				name:    "denies a partial AND group and reports the granted policies",
				granted: []string{"a"},
				deny:    missingPolicies,
				extension: `
					{
						"actualScopes": [],
						"missingPolicies": [
							{
								"coordinate": {"typeName": "Query", "fieldName": "secret"},
								"required": [["a", "b"], ["c"]]
							}
						],
						"grantedPolicies": ["a"]
					}`,
			},
			{
				name:    "allows a full AND group without authentication",
				granted: []string{"a", "b"},
			},
			{
				name:    "allows any OR group without authentication",
				granted: []string{"c"},
			},
			{
				name:                   "keeps an explicit authentication requirement",
				granted:                []string{"c"},
				requiresAuthentication: true,
				deny: &resolve.AuthorizationDeny{
					Reason: "not authenticated",
				},
			},
			{
				name:          "does not grant policies for authentication",
				authenticated: true,
				deny:          missingPolicies,
				extension: `
					{
						"actualScopes": [],
						"missingPolicies": [
							{
								"coordinate": {"typeName": "Query", "fieldName": "secret"},
								"required": [["a", "b"], ["c"]]
							}
						]
					}`,
			},
		} {
			t.Run(tt.name, func(t *testing.T) {
				t.Parallel()
				cfg := policyFieldConfig("Query", "secret", []string{"a", "b"}, []string{"c"})
				cfg.AuthorizationConfiguration.RequiresAuthentication = tt.requiresAuthentication
				a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
					FieldConfigurations: []*nodev1.FieldConfiguration{cfg},
				})
				ctx := WithAuthorizationExtension(policyContext(tt.granted, tt.authenticated))

				deny, err := a.AuthorizeObjectField(ctx, "ds", nil, coordinate("Query", "secret"))
				require.NoError(t, err)
				require.Equal(t, tt.deny, deny)

				if tt.extension == "" {
					require.False(t, a.HasResponseExtensionData(ctx))
					return
				}
				require.True(t, a.HasResponseExtensionData(ctx))
				var out bytes.Buffer
				require.NoError(t, a.RenderResponseExtension(ctx, &out))
				var expected bytes.Buffer
				require.NoError(t, json.Compact(&expected, []byte(tt.extension)))
				require.Equal(t, expected.String(), out.String())
			})
		}
	})

	t.Run("pre-fetch and batch authorization deny like the object field check", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations: []*nodev1.FieldConfiguration{
				policyFieldConfig("Query", "secret", []string{"a"}),
			},
		})
		ctx := policyContext(nil, false)

		deny, err := a.AuthorizePreFetch(ctx, "ds", nil, coordinate("Query", "secret"))
		require.NoError(t, err)
		require.Equal(t, missingPolicies, deny)

		decisions, err := a.AuthorizeFields(ctx, []resolve.GraphCoordinate{
			coordinate("Query", "secret"),
		})
		require.NoError(t, err)
		require.Equal(t, []resolve.AuthorizationDecision{
			{
				Allowed: false,
				Reason:  "missing policies",
			},
		}, decisions)
	})

	t.Run("reject mode returns ErrUnauthorized on a policy deny", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations: []*nodev1.FieldConfiguration{
				policyFieldConfig("Query", "secret", []string{"a"}),
			},
			RejectOperationIfUnauthorized: true,
		})
		ctx := policyContext(nil, false)

		_, err := a.AuthorizeObjectField(ctx, "ds", nil, coordinate("Query", "secret"))
		require.ErrorIs(t, err, ErrUnauthorized)

		_, err = a.AuthorizePreFetch(ctx, "ds", nil, coordinate("Query", "secret"))
		require.ErrorIs(t, err, ErrUnauthorized)

		_, err = a.AuthorizeFields(ctx, []resolve.GraphCoordinate{
			coordinate("Query", "secret"),
		})
		require.ErrorIs(t, err, ErrUnauthorized)
	})

	t.Run("a field with policies and scopes needs both and checks the policies first", func(t *testing.T) {
		t.Parallel()

		cfg := policyFieldConfig("Query", "secret", []string{"p"})
		cfg.AuthorizationConfiguration.RequiredOrScopes = []*nodev1.Scopes{
			{
				RequiredAndScopes: []string{"s"},
			},
		}
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations: []*nodev1.FieldConfiguration{cfg},
		})

		for _, tt := range []struct {
			name    string
			granted []string
			scopes  []string
			deny    *resolve.AuthorizationDeny
		}{
			{
				name:    "allows with the policy and the scope",
				granted: []string{"p"},
				scopes:  []string{"s"},
			},
			{
				name:    "denies without the scope",
				granted: []string{"p"},
				scopes:  []string{"other"},
				deny: &resolve.AuthorizationDeny{
					Reason: "missing required scopes",
				},
			},
			{
				name:   "denies without the policy",
				scopes: []string{"s"},
				deny:   missingPolicies,
			},
			{
				name: "reports the policy when both are missing",
				deny: missingPolicies,
			},
		} {
			t.Run(tt.name, func(t *testing.T) {
				t.Parallel()
				deny, err := a.AuthorizeObjectField(policyContext(tt.granted, true, tt.scopes...), "ds", nil, coordinate("Query", "secret"))
				require.NoError(t, err)
				require.Equal(t, tt.deny, deny)
			})
		}
	})

	t.Run("decides once per operation", func(t *testing.T) {
		t.Parallel()

		response := func() *resolve.GraphQLResponse {
			return &resolve.GraphQLResponse{
				Info: &resolve.GraphQLResponseInfo{
					AuthorizationCoordinates: []resolve.AuthorizationCoordinate{
						{
							Coordinate: coordinate("Query", "secret"),
						},
						{
							Coordinate: coordinate("Query", "secret"),
						},
					},
				},
			}
		}

		for _, tt := range []struct {
			name     string
			prepared plan.Plan
		}{
			{
				name: "synchronous plan",
				prepared: &plan.SynchronousResponsePlan{
					Response: response(),
				},
			},
			{
				name: "subscription plan",
				prepared: &plan.SubscriptionResponsePlan{
					Response: &resolve.GraphQLSubscription{
						Response: response(),
					},
				},
			},
			{
				name: "defer plan",
				prepared: &plan.DeferResponsePlan{
					Response: &resolve.GraphQLDeferResponse{
						Response: response(),
					},
				},
			},
		} {
			t.Run(tt.name, func(t *testing.T) {
				t.Parallel()
				d := &recordingPolicyDecider{}
				a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
					PolicyDecider: d,
					FieldConfigurations: []*nodev1.FieldConfiguration{
						policyFieldConfig("Query", "secret", []string{"b", "a"}, []string{"a"}),
					},
				})

				ctx, err := a.decidePolicies(context.Background(), tt.prepared)
				require.NoError(t, err)
				require.Equal(t, []string{"a", "b"}, d.required)
				require.Equal(t, 1, d.calls)

				for range 3 {
					deny, err := a.AuthorizeObjectField(resolve.NewContext(ctx), "ds", nil, coordinate("Query", "secret"))
					require.NoError(t, err)
					require.Nil(t, deny)
				}
				require.Equal(t, 1, d.calls)
			})
		}
	})

	t.Run("returns the decider error", func(t *testing.T) {
		t.Parallel()
		d := &recordingPolicyDecider{
			err: errors.New("decision unavailable"),
		}
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			PolicyDecider: d,
			FieldConfigurations: []*nodev1.FieldConfiguration{
				policyFieldConfig("Query", "secret", []string{"a"}),
			},
		})

		_, err := a.decidePolicies(context.Background(), &plan.SynchronousResponsePlan{
			Response: &resolve.GraphQLResponse{
				Info: &resolve.GraphQLResponseInfo{
					AuthorizationCoordinates: []resolve.AuthorizationCoordinate{
						{
							Coordinate: coordinate("Query", "secret"),
						},
					},
				},
			},
		})
		require.ErrorIs(t, err, d.err)
	})
}
