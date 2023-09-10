package core

import (
	"github.com/wundergraph/cosmo/router/internal/config"
	"net/http"
	"regexp"
)

var (
	_ EnginePreOriginHandler = (*HeaderRuleEngine)(nil)
)

// HeaderRuleEngine is a pre-origin handler that can be used to propagate and
// manipulate headers from the client request to the upstream
type HeaderRuleEngine struct {
	regex map[string]regexp.Regexp
	rules config.HeaderRules
}

func NewHeaderTransformer(rules config.HeaderRules) *HeaderRuleEngine {
	hf := HeaderRuleEngine{
		rules: rules,
		regex: map[string]regexp.Regexp{},
	}

	for _, rule := range rules.All.Request {
		if rule.Operation == "propagate" {
			if rule.Matching != "" {
				hf.regex[rule.Matching] = *regexp.MustCompile(rule.Matching)
			}
		}
	}

	return &hf
}

func (h HeaderRuleEngine) OnOriginRequest(request *http.Request, ctx RequestContext) (*http.Request, *http.Response) {
	for _, rule := range h.rules.All.Request {
		// Forwards the matching client request header to the upstream
		if rule.Operation == "propagate" {

			// Exact match
			if rule.Named != "" {
				value := ctx.Request().Header.Get(rule.Named)
				if value != "" {
					request.Header.Set(rule.Named, ctx.Request().Header.Get(rule.Named))
				}
				continue
			}

			// Regex match
			if regex, ok := h.regex[rule.Matching]; ok {
				for name, _ := range ctx.Request().Header {
					// Headers are case-insensitive, but Go canonicalize them
					// Issue: https://github.com/golang/go/issues/37834
					if regex.MatchString(name) {
						request.Header.Set(name, ctx.Request().Header.Get(name))
					}
				}
				continue
			}
		}
	}

	return request, nil
}
