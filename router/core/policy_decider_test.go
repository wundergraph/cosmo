package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

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

func TestPolicyDecisionOncePerOperation(t *testing.T) {
	d := &recordingPolicyDecider{}
	a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
		PolicyDecider: d,
		FieldConfigurations: []*nodev1.FieldConfiguration{
			{
				TypeName:  "Query",
				FieldName: "secret",
				AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
					RequiredOrPolicies: []*nodev1.Policies{
						{
							RequiredAndPolicies: []string{"b", "a"},
						},
						{
							RequiredAndPolicies: []string{"a"},
						},
					},
				},
			},
		},
	})
	response := &resolve.GraphQLResponse{
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
	for _, prepared := range []plan.Plan{
		&plan.SynchronousResponsePlan{
			Response: response,
		},
		&plan.SubscriptionResponsePlan{
			Response: &resolve.GraphQLSubscription{
				Response: response,
			},
		},
		&plan.DeferResponsePlan{
			Response: &resolve.GraphQLDeferResponse{
				Response: response,
			},
		},
	} {
		d.calls = 0
		ctx, err := a.decidePolicies(context.Background(), prepared)
		require.NoError(t, err)
		require.Equal(t, []string{"a", "b"}, d.required)
		require.Equal(t, 1, d.calls)
		for range 3 {
			deny, err := a.AuthorizeObjectField(resolve.NewContext(ctx), "", nil, coordinate("Query", "secret"))
			require.NoError(t, err)
			require.Nil(t, deny)
		}
		require.Equal(t, 1, d.calls)
	}
	d.err = errors.New("decision unavailable")
	_, err := a.decidePolicies(context.Background(), &plan.SynchronousResponsePlan{
		Response: response,
	})
	require.ErrorIs(t, err, d.err)
}

type headerPolicyModule struct{}

func (headerPolicyModule) DecidePolicies(ctx RequestContext, required []string) ([]string, error) {
	return ctx.Request().Header.Values("X-Policy"), nil
}

func TestModulePolicyDecider(t *testing.T) {
	d, err := newPolicyDecider(config.PolicyConfiguration{Source: "module"}, headerPolicyModule{})
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	request.Header.Add("X-Policy", "a")
	reqCtx := buildRequestContext(requestContextOptions{r: request})
	granted, err := d.Decide(withRequestContext(context.Background(), reqCtx), []string{"a"})
	require.NoError(t, err)
	require.Equal(t, []string{"a"}, granted)

	_, err = d.Decide(context.Background(), []string{"a"})
	require.Error(t, err)
}

func TestNewPolicyDecider(t *testing.T) {
	d, err := newPolicyDecider(config.PolicyConfiguration{}, headerPolicyModule{})
	require.NoError(t, err)
	require.Nil(t, d)

	_, err = newPolicyDecider(config.PolicyConfiguration{Source: "module"}, nil)
	require.Error(t, err)

	_, err = newPolicyDecider(config.PolicyConfiguration{Source: "unknown"}, headerPolicyModule{})
	require.Error(t, err)
}
