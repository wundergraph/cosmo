package module

import (
	"slices"

	"github.com/wundergraph/cosmo/router/core"
)

type PolicyModule struct {
	Granted []string `mapstructure:"granted"`
}

func init() {
	core.RegisterModule(&PolicyModule{})
}

func (m *PolicyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:  "example.policy",
		New: func() core.Module { return &PolicyModule{} },
	}
}

func (m *PolicyModule) DecidePolicies(ctx core.RequestContext, required []string) ([]string, error) {
	var granted []string
	for _, policy := range required {
		if slices.Contains(m.Granted, policy) {
			granted = append(granted, policy)
		}
	}
	return granted, nil
}

var _ core.PolicyDecisionHandler = (*PolicyModule)(nil)
