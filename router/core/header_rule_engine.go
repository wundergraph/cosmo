package core

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/config"
	"net/http"
	"regexp"
)

var (
	_          EnginePreOriginHandler = (*HeaderRuleEngine)(nil)
	hopHeaders                        = []string{
		"Connection",
		"Proxy-Connection", // non-standard but still sent by libcurl and rejected by e.g. google
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",      // canonicalized version of "TE"
		"Trailer", // not Trailers per URL above; https://www.rfc-editor.org/errata_search.php?eid=4522
		"Transfer-Encoding",
		"Upgrade",
	}
)

// HeaderRuleEngine is a pre-origin handler that can be used to propagate and
// manipulate headers from the client request to the upstream
type HeaderRuleEngine struct {
	regex map[string]regexp.Regexp
	rules config.HeaderRules
}

func NewHeaderTransformer(rules config.HeaderRules) (*HeaderRuleEngine, error) {
	hf := HeaderRuleEngine{
		rules: rules,
		regex: map[string]regexp.Regexp{},
	}

	for i, rule := range rules.All.Request {
		if rule.Operation == "propagate" {
			if rule.Matching != "" {
				regex, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, fmt.Errorf("invalid regex '%s' for all request header rule %d: %w", rule.Matching, i, err)
				}
				hf.regex[rule.Matching] = *regex
			}
		}
	}

	return &hf, nil
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
				} else if rule.Default != "" {
					request.Header.Set(rule.Named, rule.Default)
				}
				continue
			}

			// Regex match
			if regex, ok := h.regex[rule.Matching]; ok {

				for name, _ := range ctx.Request().Header {
					// Skip hop-by-hop headers and connection headers
					if contains(hopHeaders, name) {
						continue
					}
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

func contains(list []string, item string) bool {
	for _, l := range list {
		if l == item {
			return true
		}
	}
	return false
}
