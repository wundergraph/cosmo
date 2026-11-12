package core

import (
	"context"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// PolicyDecider returns the policies that the request is granted, out of the required policies of
// the operation.
type PolicyDecider interface {
	Decide(ctx context.Context, required []string) (granted []string, err error)
}

type modulePolicyDecider struct {
	handler PolicyDecisionHandler
}

func (d *modulePolicyDecider) Decide(ctx context.Context, required []string) ([]string, error) {
	reqCtx := getRequestContext(ctx)
	if reqCtx == nil {
		return nil, fmt.Errorf("policy module requires a request context")
	}
	return d.handler.DecidePolicies(reqCtx, required)
}

func newPolicyDecider(cfg config.PolicyConfiguration, handler PolicyDecisionHandler) (PolicyDecider, error) {
	switch cfg.Source {
	case "":
		return nil, nil
	case "module":
		if handler == nil {
			return nil, fmt.Errorf("authorization.policies.source module requires a PolicyDecisionHandler")
		}
		return &modulePolicyDecider{handler: handler}, nil
	default:
		return nil, fmt.Errorf("unknown policy source %q", cfg.Source)
	}
}
