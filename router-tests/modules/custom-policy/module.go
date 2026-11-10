package custom_policy

import (
	"slices"
	"sync/atomic"

	"github.com/wundergraph/cosmo/router/core"
)

const (
	ModuleID = "policyModule"
	// Header names one policy that the request offers. A request can repeat it.
	Header = "X-Policy"
)

// PolicyModule grants the required policies that the request offers in the Header.
type PolicyModule struct {
	// Calls counts the policy decisions. The pointer survives the copy of the module during the config setup.
	Calls *atomic.Int64
}

func (m *PolicyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:  ModuleID,
		New: func() core.Module { return &PolicyModule{} },
	}
}

func (m *PolicyModule) DecidePolicies(ctx core.RequestContext, required []string) ([]string, error) {
	if m.Calls != nil {
		m.Calls.Add(1)
	}
	offered := ctx.Request().Header.Values(Header)
	var granted []string
	for _, policy := range required {
		if slices.Contains(offered, policy) {
			granted = append(granted, policy)
		}
	}
	return granted, nil
}

var _ core.PolicyDecisionHandler = (*PolicyModule)(nil)
