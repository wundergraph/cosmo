package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// headerPolicyModule grants the policies that the request names in the X-Policy header.
type headerPolicyModule struct{}

func (headerPolicyModule) DecidePolicies(ctx RequestContext, required []string) ([]string, error) {
	return ctx.Request().Header.Values("X-Policy"), nil
}

func TestPolicyDecider(t *testing.T) {
	t.Parallel()

	t.Run("no source configures no decider", func(t *testing.T) {
		t.Parallel()
		d, err := newPolicyDecider(config.PolicyConfiguration{}, headerPolicyModule{})
		require.NoError(t, err)
		require.Nil(t, d)
	})

	t.Run("the module source requires a module", func(t *testing.T) {
		t.Parallel()
		_, err := newPolicyDecider(config.PolicyConfiguration{Source: "module"}, nil)
		require.Error(t, err)
	})

	t.Run("an unknown source fails", func(t *testing.T) {
		t.Parallel()
		_, err := newPolicyDecider(config.PolicyConfiguration{Source: "unknown"}, headerPolicyModule{})
		require.Error(t, err)
	})

	t.Run("the module decider passes the request context to the module", func(t *testing.T) {
		t.Parallel()
		d, err := newPolicyDecider(config.PolicyConfiguration{Source: "module"}, headerPolicyModule{})
		require.NoError(t, err)

		request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		request.Header.Add("X-Policy", "a")
		reqCtx := buildRequestContext(requestContextOptions{r: request})
		granted, err := d.Decide(withRequestContext(context.Background(), reqCtx), []string{"a"})
		require.NoError(t, err)
		require.Equal(t, []string{"a"}, granted)
	})

	t.Run("the module decider fails without a request context", func(t *testing.T) {
		t.Parallel()
		d, err := newPolicyDecider(config.PolicyConfiguration{Source: "module"}, headerPolicyModule{})
		require.NoError(t, err)

		_, err = d.Decide(context.Background(), []string{"a"})
		require.Error(t, err)
	})
}
