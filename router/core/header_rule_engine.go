package core

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"

	"github.com/wundergraph/cosmo/router/pkg/config"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

var (
	_              EnginePreOriginHandler = (*HeaderRuleEngine)(nil)
	ignoredHeaders                        = []string{
		"Alt-Svc",
		"Connection",
		"Proxy-Connection", // non-standard but still sent by libcurl and rejected by e.g. google

		// Hop-by-hop headers
		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",      // canonicalized version of "TE"
		"Trailer", // not Trailers per URL above; https://www.rfc-editor.org/errata_search.php?eid=4522
		"Transfer-Encoding",
		"Upgrade",

		// Content Negotiation. We must never propagate the client headers to the upstream
		// The router has to decide on its own what to send to the upstream
		"Content-Type",
		"Accept-Encoding",
		"Accept-Charset",
		"Accept",
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

	var rhrs []config.RequestHeaderRule

	rhrs = append(rhrs, rules.All.Request...)

	for _, subgraph := range rules.Subgraphs {
		rhrs = append(rhrs, subgraph.Request...)
	}

	for i, rule := range rhrs {
		switch rule.Operation {
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				regex, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, fmt.Errorf("invalid regex '%s' for header rule %d: %w", rule.Matching, i, err)
				}
				hf.regex[rule.Matching] = *regex
			}
		default:
			return nil, fmt.Errorf("unhandled operation '%s' for header rule %+v", rule.Operation, rule)
		}
	}

	return &hf, nil
}

func (h HeaderRuleEngine) OnOriginRequest(request *http.Request, ctx RequestContext) (*http.Request, *http.Response) {
	requestRules := h.rules.All.Request

	subgraph := ctx.ActiveSubgraph(request)
	if subgraph != nil {
		if subgraphRules, ok := h.rules.Subgraphs[subgraph.Name]; ok {
			requestRules = append(requestRules, subgraphRules.Request...)
		}
	}

	for _, rule := range requestRules {
		if rule.Operation == config.HeaderRuleOperationPropagate {

			/**
			 *	Rename the header before propagating and delete the original
			 */

			if rule.Rename != "" && rule.Named != "" {
				// Ignore the rule when the target header is in the ignored list
				if slices.Contains(ignoredHeaders, rule.Rename) {
					continue
				}

				value := ctx.Request().Header.Get(rule.Named)
				if value != "" {
					request.Header.Set(rule.Rename, ctx.Request().Header.Get(rule.Named))
					request.Header.Del(rule.Named)
					continue
				} else if rule.Default != "" {
					request.Header.Set(rule.Rename, rule.Default)
					request.Header.Del(rule.Named)
					continue
				}

				continue
			}

			/**
			 *	Propagate the header as is
			 */

			if rule.Named != "" {
				if slices.Contains(ignoredHeaders, rule.Named) {
					continue
				}

				value := ctx.Request().Header.Get(rule.Named)
				if value != "" {
					request.Header.Set(rule.Named, ctx.Request().Header.Get(rule.Named))
				} else if rule.Default != "" {
					request.Header.Set(rule.Named, rule.Default)
				}

				continue
			}

			/**
			 * Matching based on regex
			 */

			if regex, ok := h.regex[rule.Matching]; ok {
				for name := range ctx.Request().Header {
					// Headers are case-insensitive, but Go canonicalize them
					// Issue: https://github.com/golang/go/issues/37834
					if regex.MatchString(name) {

						/**
						 *	Rename the header before propagating and delete the original
						 */
						if rule.Rename != "" && rule.Named == "" {

							if slices.Contains(ignoredHeaders, rule.Rename) {
								continue
							}

							value := ctx.Request().Header.Get(name)
							if value != "" {
								request.Header.Set(rule.Rename, ctx.Request().Header.Get(name))
								request.Header.Del(name)
							} else if rule.Default != "" {
								request.Header.Set(rule.Rename, rule.Default)
								request.Header.Del(name)
							}

							continue
						}

						/**
						 *	Propagate the header as is
						 */
						if slices.Contains(ignoredHeaders, name) {
							continue
						}
						request.Header.Set(name, ctx.Request().Header.Get(name))
					}
				}
			}
		}
	}

	return request, nil
}

// SubgraphRules returns the list of header rules for the subgraph with the given name
func SubgraphRules(rules *config.HeaderRules, subgraphName string) []config.RequestHeaderRule {
	var subgraphRules []config.RequestHeaderRule
	subgraphRules = append(subgraphRules, rules.All.Request...)
	subgraphRules = append(subgraphRules, rules.Subgraphs[subgraphName].Request...)
	return subgraphRules
}

// FetchURLRules returns the list of header rules for first subgraph that matches the given URL
func FetchURLRules(rules *config.HeaderRules, subgraphs []*nodev1.Subgraph, routingURL string) []config.RequestHeaderRule {
	var subgraphName string
	for _, subgraph := range subgraphs {
		if subgraph.RoutingUrl == routingURL {
			subgraphName = subgraph.Name
			break
		}
	}
	return SubgraphRules(rules, subgraphName)
}

// PropagatedHeaders returns the list of header names and regular expressions
// that will be propagated when applying the given rules.
func PropagatedHeaders(rules []config.RequestHeaderRule) (headerNames []string, headerNameRegexps []*regexp.Regexp, err error) {
	for _, rule := range rules {
		switch rule.Operation {
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				re, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, nil, fmt.Errorf("error compiling regular expression %q in header rule %+v: %w", rule.Matching, rule, err)
				}
				headerNameRegexps = append(headerNameRegexps, re)
			} else if rule.Named != "" {
				headerNames = append(headerNames, rule.Named)
			} else {
				return nil, nil, fmt.Errorf("invalid header propagation rule %+v, no header name nor regular expression", rule)
			}
		default:
			return nil, nil, fmt.Errorf("invalid header rule operation %q in rule %+v", rule.Operation, rule)
		}
	}
	return headerNames, headerNameRegexps, nil
}
