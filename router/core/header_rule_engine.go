package core

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/expr-lang/expr/vm"
	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var (
	_                     EnginePostOriginHandler = (*HeaderPropagation)(nil)
	cacheControlKey                               = "Cache-Control"
	expiresKey                                    = "Expires"
	noCache                                       = "no-cache"
	caseInsensitiveRegexp                         = "(?i)"
)

// ignoredHeaderPrefixes are prefixes for headers that should not be forwarded to downstream services.
var ignoredHeaderPrefixes = []string{
	"Grpc-", // reserved in gRPC metadata
}

// isIgnoredHeader reports whether a header should never be propagated to subgraphs.
// It checks both the exact ignoredHeaders list and any prefix in ignoredHeaderPrefixes.
func isIgnoredHeader(name string) bool {
	canonicalName := http.CanonicalHeaderKey(name)

	if _, ok := headers.SkippedHeaders[canonicalName]; ok {
		return true
	}
	for _, prefix := range ignoredHeaderPrefixes {
		if strings.HasPrefix(canonicalName, prefix) {
			return true
		}
	}
	return false
}

type responseHeaderPropagationKey struct{}

type responseHeaderPropagation struct {
	header               http.Header
	m                    *sync.Mutex
	previousCacheControl *cachedirective.Object
	setCacheControl      bool
}

func WithResponseHeaderPropagation(ctx *resolve.Context) *resolve.Context {
	return ctx.WithContext(context.WithValue(ctx.Context(), responseHeaderPropagationKey{}, &responseHeaderPropagation{
		header: make(http.Header),
		m:      &sync.Mutex{},
	}))
}

func getResponseHeaderPropagation(ctx context.Context) *responseHeaderPropagation {
	v := ctx.Value(responseHeaderPropagationKey{})
	if v == nil {
		return nil
	}
	return v.(*responseHeaderPropagation)
}

func HeaderPropagationWriter(w http.ResponseWriter, resolveCtx *resolve.Context, setContentLength bool) io.Writer {
	propagation := getResponseHeaderPropagation(resolveCtx.Context())
	return &headerPropagationWriter{
		writer:            w,
		headerPropagation: propagation,
		propagateHeaders:  propagation != nil,
		setContentLength:  setContentLength,
		resolveCtx:        resolveCtx,
	}
}

type headerPropagationWriter struct {
	setContentLength          bool
	propagateHeaders          bool
	writer                    http.ResponseWriter
	headerPropagation         *responseHeaderPropagation
	resolveCtx                *resolve.Context
	didSetSubgraphErrors      bool
	routerHeaderPropagation   *HeaderPropagation
	reqCtx                    *requestContext
	didApplyRouterRespHeaders bool
	costHeaderSetter          func(actualListSizes map[string]int)
	didSetCostHeaders         bool
}

func (h *headerPropagationWriter) Write(p []byte) (n int, err error) {
	if h.setContentLength {
		// setContentLength assumes this Write is called exactly once with the entire body
		h.writer.Header().Set("Content-Length", strconv.Itoa(len(p)))
		h.setContentLength = false
	}
	if h.propagateHeaders {
		wh := h.writer.Header()
		for k, v := range h.headerPropagation.header {
			for _, el := range v {
				wh.Add(k, el)
			}
		}
		h.propagateHeaders = false
	}
	if errs := h.resolveCtx.SubgraphErrors(); errs != nil && !h.didSetSubgraphErrors {
		h.writer.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		h.didSetSubgraphErrors = true
		trackFinalResponseError(h.resolveCtx.Context(), errs)
	}
	if h.routerHeaderPropagation != nil && !h.didApplyRouterRespHeaders {
		h.didApplyRouterRespHeaders = true
		if err := h.routerHeaderPropagation.ApplyRouterResponseHeaderRules(h.writer, h.reqCtx); err != nil {
			if h.reqCtx != nil {
				h.reqCtx.logger.Error("Failed to apply router response header rules", zap.Error(err))
			}
		}
	}
	if h.costHeaderSetter != nil && !h.didSetCostHeaders {
		h.didSetCostHeaders = true
		h.costHeaderSetter(h.resolveCtx.ActualListSizes)
	}
	return h.writer.Write(p)
}

// HeaderPropagation is a pre-origin handler that can be used to propagate and
// manipulate headers from the client request to the upstream
type HeaderPropagation struct {
	regex                       map[string]*regexp.Regexp
	rules                       *config.HeaderRules
	compiledRules               map[string]*vm.Program
	compiledRouterResponseRules map[string]*vm.Program
	hasRequestRules             bool
	hasResponseRules            bool
	// Precomputed request rule presence for fast-path checks
	hasAllRequestRules      bool
	subgraphHasRequestRules map[string]bool
	// groupRegex holds the compiled regex for each group's `matching` selector.
	// The slice is index-aligned with rules.Groups; entries for groups that have
	// no `matching` selector are nil. Compiled once at startup.
	groupRegex []*regexp.Regexp
	// subgraphToGroupIdx maps an explicit `subgraphs:` entry to the indices of the
	// groups that list it. Lets us look up group membership in O(1) at request
	// time instead of scanning every group's list.
	subgraphToGroupIdx map[string][]int
	// hasAnyGroupRequestRules is true when at least one group defines request
	// rules. Used as a fast-path so subgraphs with no `all`/exact rules can still
	// skip group evaluation entirely when no groups are configured.
	hasAnyGroupRequestRules bool
	// hasAnyGroupRegex is true when at least one group has a `matching` selector,
	// so we know whether the group matching loop needs to evaluate regexes at all.
	hasAnyGroupRegex bool
}

func initHeaderRules(rules *config.HeaderRules) {
	if rules.All == nil {
		rules.All = &config.GlobalHeaderRule{}
	}
	if rules.Subgraphs == nil {
		rules.Subgraphs = make(map[string]*config.GlobalHeaderRule)
	}
}

func NewHeaderPropagation(rules *config.HeaderRules) (*HeaderPropagation, error) {
	if rules == nil {
		return nil, nil
	}

	initHeaderRules(rules)
	hf := HeaderPropagation{
		rules:                       rules,
		regex:                       map[string]*regexp.Regexp{},
		compiledRules:               map[string]*vm.Program{},
		compiledRouterResponseRules: map[string]*vm.Program{},
	}

	// Validate groups, compile their selector regexes, and build the
	// subgraph-name -> group-index inverse index. Doing this up-front means
	// per-request group evaluation is an O(1) map lookup plus an O(g) regex
	// scan over only those groups that actually use `matching`.
	if err := hf.indexGroups(); err != nil {
		return nil, err
	}

	rhrs, rhrrs, rrs := hf.getAllRules()
	hf.hasRequestRules = len(rhrs) > 0
	hf.hasResponseRules = len(rhrrs) > 0

	// Pre-compute request rule presence
	hf.hasAllRequestRules = len(hf.rules.All.Request) > 0
	if !hf.hasAllRequestRules {
		// Only build a per-subgraph map if we don't have global rules
		hf.subgraphHasRequestRules = make(map[string]bool, len(hf.rules.Subgraphs))
		for name, sg := range hf.rules.Subgraphs {
			if sg != nil && len(sg.Request) > 0 {
				hf.subgraphHasRequestRules[name] = true
			}
		}
	}

	if err := hf.collectRuleMatchers(rhrs, rhrrs); err != nil {
		return nil, err
	}

	if err := hf.compileExpressionRules(rhrs, rrs); err != nil {
		return nil, err
	}

	return &hf, nil
}

// indexGroups validates each subgraph header group and populates the lookup
// structures used during request handling. Validation rules:
//   - `id` is required and must be unique across groups
//   - at least one of `subgraphs` / `matching` must be set (a group with no
//     selector would never apply, which is almost always a misconfiguration)
//   - at least one of `request` / `response` must be set (an empty group has
//     no effect)
//   - `matching`, when present, must compile as a Go regular expression
//
// Validation runs at router init so misconfiguration fails startup rather than
// silently producing wrong header sets at request time.
func (h *HeaderPropagation) indexGroups() error {
	if len(h.rules.Groups) == 0 {
		return nil
	}

	h.groupRegex = make([]*regexp.Regexp, len(h.rules.Groups))
	h.subgraphToGroupIdx = make(map[string][]int)
	seenID := make(map[string]struct{}, len(h.rules.Groups))

	for i, g := range h.rules.Groups {
		if g == nil {
			return fmt.Errorf("headers.groups[%d] is nil", i)
		}
		if g.ID == "" {
			return fmt.Errorf("headers.groups[%d] is missing required field 'id'", i)
		}
		if _, dup := seenID[g.ID]; dup {
			return fmt.Errorf("duplicate headers.groups id %q", g.ID)
		}
		seenID[g.ID] = struct{}{}

		if len(g.Subgraphs) == 0 && g.Matching == "" {
			return fmt.Errorf("headers.groups[%q] must specify at least one of 'subgraphs' or 'matching'", g.ID)
		}
		if len(g.Request) == 0 && len(g.Response) == 0 {
			return fmt.Errorf("headers.groups[%q] must specify at least one of 'request' or 'response' rules", g.ID)
		}

		if g.Matching != "" {
			re, err := regexp.Compile(g.Matching)
			if err != nil {
				return fmt.Errorf("invalid regex %q in headers.groups[%q]: %w", g.Matching, g.ID, err)
			}
			h.groupRegex[i] = re
			h.hasAnyGroupRegex = true
		}

		for _, name := range g.Subgraphs {
			if name == "" {
				return fmt.Errorf("headers.groups[%q] contains an empty subgraph name", g.ID)
			}
			h.subgraphToGroupIdx[name] = append(h.subgraphToGroupIdx[name], i)
		}

		if len(g.Request) > 0 {
			h.hasAnyGroupRequestRules = true
		}
	}

	return nil
}

func AddCacheControlPolicyToRules(rules *config.HeaderRules, cacheControl config.CacheControlPolicy) *config.HeaderRules {
	if rules == nil {
		rules = &config.HeaderRules{}
		if !cacheControl.Enabled && cacheControl.Subgraphs == nil {
			return nil
		}
	}

	initHeaderRules(rules)
	if cacheControl.Enabled {
		rules.All.Response = append(rules.All.Response, &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Algorithm: config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl,
			Default:   cacheControl.Value,
		})
	}

	for _, graph := range cacheControl.Subgraphs {
		subgraphRules, ok := rules.Subgraphs[graph.Name]
		if !ok {
			subgraphRules = &config.GlobalHeaderRule{Response: make([]*config.ResponseHeaderRule, 0)}
		}

		subgraphRules.Response = append(subgraphRules.Response, &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Algorithm: config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl,
			Default:   graph.Value,
		})

		rules.Subgraphs[graph.Name] = subgraphRules
	}

	return rules
}

func (h *HeaderPropagation) getAllRules() ([]*config.RequestHeaderRule, []*config.ResponseHeaderRule, []*config.RouterResponseHeaderRule) {
	rhrs := h.rules.All.Request
	for _, subgraph := range h.rules.Subgraphs {
		rhrs = append(rhrs, subgraph.Request...)
	}
	for _, group := range h.rules.Groups {
		if group == nil {
			continue
		}
		rhrs = append(rhrs, group.Request...)
	}

	rhrrs := h.rules.All.Response
	for _, subgraph := range h.rules.Subgraphs {
		rhrrs = append(rhrrs, subgraph.Response...)
	}
	for _, group := range h.rules.Groups {
		if group == nil {
			continue
		}
		rhrrs = append(rhrrs, group.Response...)
	}

	return rhrs, rhrrs, h.rules.Router.Response
}

func (h *HeaderPropagation) processRule(rule config.HeaderRule, index int) error {
	switch rule.GetOperation() {
	case config.HeaderRuleOperationSet:
	case config.HeaderRuleOperationPropagate:
		if rule.GetMatching() != "" {
			regex, err := regexp.Compile(caseInsensitiveRegexp + rule.GetMatching())
			if err != nil {
				return fmt.Errorf("invalid regex '%s' for header rule %d: %w", rule.GetMatching(), index, err)
			}
			h.regex[rule.GetMatching()] = regex
		}
	default:
		return fmt.Errorf("unhandled operation '%s' for header rule %+v", rule.GetOperation(), rule)
	}
	return nil
}

func (h *HeaderPropagation) collectRuleMatchers(rhrs []*config.RequestHeaderRule, rhrrs []*config.ResponseHeaderRule) error {
	for i, rule := range rhrs {
		if err := h.processRule(rule, i); err != nil {
			return err
		}
	}

	for i, rule := range rhrrs {
		if err := h.processRule(rule, i); err != nil {
			return err
		}
	}

	return nil
}

func (h *HeaderPropagation) compileExpressionRules(requestRules []*config.RequestHeaderRule, routerResponseRules []*config.RouterResponseHeaderRule) error {
	manager := expr.CreateNewExprManager()
	for _, rule := range requestRules {
		if rule.Expression == "" {
			continue
		}
		if _, ok := h.compiledRules[rule.Expression]; ok {
			continue
		}
		program, err := manager.CompileExpression(rule.Expression, reflect.String)
		if err != nil {
			return fmt.Errorf("error compiling expression %s for header rule %s: %w", rule.Expression, rule.Name, err)
		}
		h.compiledRules[rule.Expression] = program
	}
	for _, rule := range routerResponseRules {
		if rule.Expression == "" {
			continue
		}
		if _, ok := h.compiledRouterResponseRules[rule.Expression]; ok {
			continue
		}
		program, err := manager.CompileExpression(rule.Expression, reflect.String)
		if err != nil {
			return fmt.Errorf("error compiling expression %s for header rule %s: %w", rule.Expression, rule.Name, err)
		}
		h.compiledRouterResponseRules[rule.Expression] = program
	}
	return nil
}

func (h *HeaderPropagation) HasRequestRules() bool {
	if h == nil {
		return false
	}
	return h.hasRequestRules
}

func (h *HeaderPropagation) HasResponseRules() bool {
	if h == nil {
		return false
	}
	return h.hasResponseRules
}

// BuildRequestHeaderForSubgraph builds headers for an outbound subgraph request
// as if the propagation rules were applied during transport. It returns the
// resulting headers and a stable hash over all header names and values that is
// independent of map iteration order.
func (h *HeaderPropagation) BuildRequestHeaderForSubgraph(subgraphName string, ctx *requestContext) (http.Header, uint64) {
	if h == nil || h.rules == nil || ctx == nil || ctx.Request() == nil {
		return http.Header{}, 0
	}

	// Fast-path: if we know no request rules apply to this subgraph, skip cache and building
	if !h.hasRequestRulesForSubgraph(subgraphName) {
		return nil, 0
	}

	// Build headers in a fresh map without relying on a subgraph request seed.
	outHeader := make(http.Header)

	// Apply global rules
	for _, rule := range h.rules.All.Request {
		h.applyRequestRuleToHeader(ctx, outHeader, rule)
	}

	// Apply group rules. Groups are evaluated in config order, applying any group
	// whose selector (explicit list or regex) matches the subgraph. Groups run
	// after `all` and before exact-name rules so an explicit per-subgraph rule
	// can still override a group rule (e.g. via op: set).
	if subgraphName != "" {
		h.forEachMatchingGroup(subgraphName, func(g *config.SubgraphHeaderGroup) {
			for _, rule := range g.Request {
				h.applyRequestRuleToHeader(ctx, outHeader, rule)
			}
		})
	}

	// Apply subgraph-specific rules
	if subgraphName != "" {
		if subRules, ok := h.rules.Subgraphs[subgraphName]; ok {
			for _, rule := range subRules.Request {
				h.applyRequestRuleToHeader(ctx, outHeader, rule)
			}
		}
	}

	headerHash := hashHeaderStable(outHeader)
	return outHeader, headerHash
}

// forEachMatchingGroup invokes fn for every group whose selector matches the
// given subgraph name, in config order. A group matches if either its explicit
// `Subgraphs` list contains the name OR its `Matching` regex matches the name
// (the regex result is inverted when NegateMatch is true). The two halves of
// the selector are OR-combined; explicit list membership is always positive
// regardless of NegateMatch.
//
// The function deduplicates groups: a group that lists the subgraph and also
// matches via its regex still fires only once.
func (h *HeaderPropagation) forEachMatchingGroup(subgraphName string, fn func(*config.SubgraphHeaderGroup)) {
	if h == nil || len(h.rules.Groups) == 0 {
		return
	}

	// Track already-applied group indices to avoid double-applying when both
	// list and regex match. Most configs will have small group counts, so a
	// fixed-size bitset on the stack via a slice of bools is fine here.
	applied := make([]bool, len(h.rules.Groups))

	// First, apply groups that include the subgraph in their explicit list. The
	// inverse index lets us do this in O(1) per match instead of scanning every
	// group.
	if idxs, ok := h.subgraphToGroupIdx[subgraphName]; ok {
		for _, i := range idxs {
			if applied[i] {
				continue
			}
			applied[i] = true
		}
	}

	// Then walk groups in config order and apply: list-matched groups (already
	// flagged above) and regex-matched groups (evaluated lazily here). This walk
	// preserves config order so users can reason about precedence between
	// multiple matching groups.
	for i, g := range h.rules.Groups {
		if g == nil {
			continue
		}
		if !applied[i] {
			// Try regex match if the group has one configured.
			if h.hasAnyGroupRegex && h.groupRegex[i] != nil {
				matched := h.groupRegex[i].MatchString(subgraphName)
				if g.NegateMatch {
					matched = !matched
				}
				if !matched {
					continue
				}
				applied[i] = true
			} else {
				continue
			}
		}
		fn(g)
	}
}

// hasRequestRulesForSubgraph returns true if there are request header rules
// that would apply to the given subgraph. The result is computed at creation
// time for `all` and exact-name rules, and computed on demand for groups
// because group selectors depend on the runtime subgraph name.
func (h *HeaderPropagation) hasRequestRulesForSubgraph(subgraphName string) bool {
	if h == nil || h.rules == nil {
		return false
	}
	if h.hasAllRequestRules {
		// At least one global rule applies to all subgraphs
		return true
	}
	if subgraphName == "" {
		// No subgraph specified and no global rules
		return false
	}
	if h.subgraphHasRequestRules != nil && h.subgraphHasRequestRules[subgraphName] {
		return true
	}
	if h.hasAnyGroupRequestRules {
		// Walk only as far as needed to find a match. The forEachMatchingGroup
		// helper is overkill here because we only need a yes/no answer.
		if idxs, ok := h.subgraphToGroupIdx[subgraphName]; ok {
			for _, i := range idxs {
				if g := h.rules.Groups[i]; g != nil && len(g.Request) > 0 {
					return true
				}
			}
		}
		if h.hasAnyGroupRegex {
			for i, g := range h.rules.Groups {
				if g == nil || len(g.Request) == 0 || h.groupRegex[i] == nil {
					continue
				}
				matched := h.groupRegex[i].MatchString(subgraphName)
				if g.NegateMatch {
					matched = !matched
				}
				if matched {
					return true
				}
			}
		}
	}
	return false
}

// hashHeaderStable computes a deterministic 64-bit hash over the provided header map.
// It is independent of map iteration order and minimizes allocations.
func hashHeaderStable(hdr http.Header) uint64 {
	if len(hdr) == 0 {
		return 0
	}

	keys := make([]string, len(hdr))
	i := 0
	for k := range hdr {
		keys[i] = k
		i++
	}
	sort.Strings(keys)

	d := xxhash.New()
	for _, k := range keys {
		_, _ = d.WriteString(k)
		_, _ = d.WriteString("\x00")
		// Iterate values without creating copies to avoid allocations
		vals := hdr[k]
		for i := 0; i < len(vals); i++ {
			_, _ = d.WriteString(vals[i])
			_, _ = d.WriteString("\x00")
		}
		_, _ = d.WriteString("\x01")
	}

	return d.Sum64()
}

// ApplyResponseHeaderRules applies response header rules for a subgraph fetch.
// Called from OnFinished for every fetch (both singleflight leaders and followers).
func (h *HeaderPropagation) ApplyResponseHeaderRules(ctx context.Context, headers http.Header, subgraphName string, statusCode int, request *http.Request) {
	propagation := getResponseHeaderPropagation(ctx)
	if propagation == nil {
		return
	}

	resp := &http.Response{
		StatusCode: statusCode,
		Header:     headers,
	}
	if request != nil {
		resp.Request = request
	} else {
		resp.Request = (&http.Request{}).WithContext(ctx)
	}

	for _, rule := range h.rules.All.Response {
		h.applyResponseRule(propagation, resp, rule)
	}

	// Apply group response rules in config order, after `all` and before exact
	// subgraph rules so an explicit per-subgraph rule can still override a
	// group rule.
	if subgraphName != "" {
		h.forEachMatchingGroup(subgraphName, func(g *config.SubgraphHeaderGroup) {
			for _, rule := range g.Response {
				h.applyResponseRule(propagation, resp, rule)
			}
		})
	}

	if subgraphName != "" {
		if subgraphRules, ok := h.rules.Subgraphs[subgraphName]; ok {
			for _, rule := range subgraphRules.Response {
				h.applyResponseRule(propagation, resp, rule)
			}
		}
	}
}

func (h *HeaderPropagation) OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response {
	// Response header rules are now applied in the engine loader hooks (OnFinished)
	// via ApplyResponseHeaderRules, not here. This ensures both singleflight leaders
	// and followers are handled uniformly. This method is kept for module compatibility.
	return resp
}

func (h *HeaderPropagation) applyResponseRule(propagation *responseHeaderPropagation, res *http.Response, rule *config.ResponseHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		propagation.m.Lock()
		propagation.header.Set(rule.Name, rule.Value)
		if rule.Name == cacheControlKey {
			// Handle the case where the cache control header is set explicitly
			propagation.setCacheControl = true
		}
		propagation.m.Unlock()
		return
	}

	if rule.Operation != config.HeaderRuleOperationPropagate {
		return
	}

	if rule.Named != "" {
		if isIgnoredHeader(rule.Named) {
			return
		}

		values := res.Header.Values(rule.Named)
		if len(values) > 0 {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, values)
		} else if rule.Default != "" {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, []string{rule.Default})
		}

		return
	} else if rule.Matching != "" {
		if regex, ok := h.regex[rule.Matching]; ok {
			for name := range res.Header {
				result := regex.MatchString(name)
				if rule.NegateMatch {
					result = !result
				}
				if result {
					if isIgnoredHeader(name) {
						continue
					}
					values := res.Header.Values(name)
					h.applyResponseRuleKeyValue(res, propagation, rule, name, values)
				}
			}
		}
	} else if rule.Algorithm == config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl {
		// Explicitly apply the CacheControl algorithm on the headers
		h.applyResponseRuleKeyValue(res, propagation, rule, "", []string{""})
	}
}

func (h *HeaderPropagation) applyResponseRuleKeyValue(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule, key string, values []string) {
	// Since we'll be setting the header map directly, we need to canonicalize the key
	key = http.CanonicalHeaderKey(key)
	switch rule.Algorithm {
	case config.ResponseHeaderRuleAlgorithmFirstWrite:
		propagation.m.Lock()
		if val := propagation.header.Get(key); val == "" {
			propagation.header[key] = values
		}
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmLastWrite:
		propagation.m.Lock()
		propagation.header[key] = values
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmAppend:
		propagation.m.Lock()
		// Set-Cookie cannot be comma-combined per RFC 6265 — commas appear
		// inside cookie values (e.g. Expires dates), so each cookie must
		// remain a separate header line.
		if key == "Set-Cookie" {
			propagation.header[key] = append(propagation.header[key], values...)
		} else {
			all := append(propagation.header[key], values...)
			propagation.header.Set(key, strings.Join(all, ","))
		}
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl:
		h.applyResponseRuleMostRestrictiveCacheControl(res, propagation, rule)
	}
}

func (h *HeaderPropagation) applyRequestRuleToHeader(ctx *requestContext, header http.Header, rule *config.RequestHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		if rule.ValueFrom != nil && rule.ValueFrom.ContextField != "" {
			val := getCustomDynamicAttributeValue(rule.ValueFrom, ctx, nil)
			value := fmt.Sprintf("%v", val)
			if value != "" {
				header.Set(rule.Name, value)
			}
			return
		}

		if rule.Expression != "" {
			value, err := h.getRequestRuleExpressionValue(rule, ctx)
			if err != nil {
				ctx.SetError(err)
			} else if value != "" {
				header.Set(rule.Name, value)
			}
			return
		}

		header.Set(rule.Name, rule.Value)
		return
	}

	if rule.Operation != config.HeaderRuleOperationPropagate {
		return
	}

	/**
	 *	Rename the header before propagating and delete the original
	 */

	if rule.Rename != "" && rule.Named != "" {
		// Ignore the rule when the target header is in the ignored list
		if isIgnoredHeader(rule.Rename) {
			return
		}

		value := ctx.Request().Header.Get(rule.Named)
		if value != "" {
			header.Set(rule.Rename, ctx.Request().Header.Get(rule.Named))
			header.Del(rule.Named)
			return
		} else if rule.Default != "" {
			header.Set(rule.Rename, rule.Default)
			header.Del(rule.Named)
			return
		}

		return
	}

	/**
	 *	Propagate the header as is
	 */

	if rule.Named != "" {
		if isIgnoredHeader(rule.Named) {
			return
		}

		values := ctx.Request().Header.Values(rule.Named)
		if len(values) > 0 {
			header[http.CanonicalHeaderKey(rule.Named)] = values
		} else if rule.Default != "" {
			header.Set(rule.Named, rule.Default)
		}

		return
	}

	/**
	 * Matching based on regex
	 */

	if regex, ok := h.regex[rule.Matching]; ok {
		// Headers are case-insensitive, but Go canonicalize them
		// Issue: https://github.com/golang/go/issues/37834
		for name := range ctx.Request().Header {
			result := regex.MatchString(name)
			if rule.NegateMatch {
				result = !result
			}

			if result {
				/**
				 *	Rename the header before propagating and delete the original
				 */
				if rule.Rename != "" && rule.Named == "" {

					if isIgnoredHeader(rule.Rename) {
						continue
					}

					value := ctx.Request().Header.Get(name)
					if value != "" {
						header.Set(rule.Rename, ctx.Request().Header.Get(name))
						header.Del(name)
					} else if rule.Default != "" {
						header.Set(rule.Rename, rule.Default)
						header.Del(name)
					}

					continue
				}

				/**
				 *	Propagate the header as is
				 */
				if isIgnoredHeader(name) {
					continue
				}
				header.Set(name, ctx.Request().Header.Get(name))
			}
		}
	}
}

func (h *HeaderPropagation) applyResponseRuleMostRestrictiveCacheControl(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule) {
	propagation.m.Lock()
	if propagation.setCacheControl {
		propagation.m.Unlock()
		// Handle the case where the cache control header is set explicitly using the set propagation rule
		return
	}
	previousCacheControl := propagation.previousCacheControl
	propagation.m.Unlock()

	ctx := res.Request.Context()
	tracer := rtrace.TracerFromContext(ctx)
	commonAttributes := []attribute.KeyValue{
		otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
	}

	_, span := tracer.Start(ctx, "HeaderPropagation - RestrictiveCacheControl",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(commonAttributes...),
	)
	defer span.End()

	// Set no-cache for all mutations, to ensure that requests to mutate data always work as expected (without returning cached data)
	if resolve.GetOperationTypeFromContext(ctx) == ast.OperationTypeMutation {
		propagation.m.Lock()
		if propagation.setCacheControl {
			propagation.m.Unlock()
			return
		}
		propagation.header.Set(cacheControlKey, noCache)
		propagation.m.Unlock()
		return
	}

	reqCacheHeader := res.Request.Header.Get(cacheControlKey)
	resCacheHeader := res.Header.Get(cacheControlKey)
	expiresHeader, _ := http.ParseTime(res.Header.Get(expiresKey))
	dateHeader, _ := http.ParseTime(res.Header.Get("Date"))
	lastModifiedHeader, _ := http.ParseTime(res.Header.Get("Last-Modified"))

	if previousCacheControl == nil && reqCacheHeader == "" && resCacheHeader == "" && expiresHeader.IsZero() && rule.Default == "" {
		// There is no default/previous value to set, and since no cache control headers have been set, exit early
		return
	}

	reqDir, _ := cachedirective.ParseRequestCacheControl(reqCacheHeader)
	resDir, _ := cachedirective.ParseResponseCacheControl(resCacheHeader)
	obj := &cachedirective.Object{
		RespDirectives:         resDir,
		RespHeaders:            res.Header,
		RespStatusCode:         res.StatusCode,
		RespExpiresHeader:      expiresHeader,
		RespDateHeader:         dateHeader,
		RespLastModifiedHeader: lastModifiedHeader,
		ReqDirectives:          reqDir,
		ReqHeaders:             res.Request.Header,
		NowUTC:                 time.Now().UTC(),
	}
	rv := cachedirective.ObjectResults{}
	cachedirective.CachableObject(obj, &rv)
	cachedirective.ExpirationObject(obj, &rv)

	span.SetAttributes(
		otel.WgResponseCacheControlReasons.String(fmt.Sprint(rv.OutReasons)),
		otel.WgResponseCacheControlWarnings.String(fmt.Sprint(rv.OutWarnings)),
		otel.WgResponseCacheControlExpiration.String(rv.OutExpirationTime.String()),
	)

	var defaultPolicy *cachedirective.Object
	if rule.Default != "" {
		defaultResponseCache, _ := cachedirective.ParseResponseCacheControl(rule.Default)
		defaultPolicy = &cachedirective.Object{RespDirectives: defaultResponseCache}
	}

	propagation.m.Lock()
	defer propagation.m.Unlock()
	if propagation.setCacheControl {
		// We compute restrictivePolicy outside the lock. If a concurrent
		// response applied an explicit `set` Cache-Control rule in the meantime,
		// that explicit value must win; drop this computed result.
		return
	}
	// Merge with the current shared state under lock to avoid lost updates when
	// multiple subgraph responses compute policies concurrently.
	policies := []*cachedirective.Object{obj}
	if defaultPolicy != nil {
		policies = append(policies, defaultPolicy)
	}
	if propagation.previousCacheControl != nil {
		policies = append(policies, propagation.previousCacheControl)
	}

	restrictivePolicy, cacheControlHeader := createMostRestrictivePolicy(policies)
	propagation.previousCacheControl = restrictivePolicy
	if cacheControlHeader != "" {
		propagation.header.Set(cacheControlKey, cacheControlHeader)
	}

	// Update the Expires header if applicable
	if !expiresHeader.IsZero() && !restrictivePolicy.RespExpiresHeader.IsZero() {
		propagation.header.Set(expiresKey, restrictivePolicy.RespExpiresHeader.Format(http.TimeFormat))
	}
}

func (h *HeaderPropagation) getRequestRuleExpressionValue(rule *config.RequestHeaderRule, reqCtx *requestContext) (value string, err error) {
	if reqCtx == nil {
		return "", fmt.Errorf("context cannot be nil")
	}
	program, ok := h.compiledRules[rule.Expression]
	if !ok {
		return "", fmt.Errorf("expression %s not found in compiled rules for header rule %s", rule.Expression, rule.Name)
	}
	value, err = expr.ResolveStringExpression(program, reqCtx.expressionContext)
	if err != nil {
		return "", fmt.Errorf("unable to resolve expression %q for header rule %s: %s", rule.Expression, rule.Name, err.Error())
	}
	return
}

func (h *HeaderPropagation) getRouterResponseRuleExpressionValue(rule *config.RouterResponseHeaderRule, reqCtx *requestContext) (value string, err error) {
	if reqCtx == nil {
		return "", fmt.Errorf("context cannot be nil")
	}
	program, ok := h.compiledRouterResponseRules[rule.Expression]
	if !ok {
		return "", fmt.Errorf("expression %s not found in compiled rules for header rule %s", rule.Expression, rule.Name)
	}
	value, err = expr.ResolveStringExpression(program, reqCtx.expressionContext)
	if err != nil {
		return "", fmt.Errorf("unable to resolve expression %q for header rule %s: %w", rule.Expression, rule.Name, err)
	}
	return
}

// ApplyRouterResponseHeaderRules applies router response header rules to the response writer
func (h *HeaderPropagation) ApplyRouterResponseHeaderRules(w http.ResponseWriter, reqCtx *requestContext) error {
	for _, rule := range h.rules.Router.Response {
		if rule.Expression == "" {
			continue
		}
		value, err := h.getRouterResponseRuleExpressionValue(rule, reqCtx)
		if err != nil {
			return fmt.Errorf("failed to evaluate router response header expression for %s: %w", rule.Name, err)
		}
		if value != "" {
			w.Header().Set(rule.Name, value)
		}
	}

	return nil
}

func createMostRestrictivePolicy(policies []*cachedirective.Object) (*cachedirective.Object, string) {
	result := cachedirective.Object{
		RespDirectives: &cachedirective.ResponseCacheDirectives{},
	}
	var minMaxAge cachedirective.DeltaSeconds = -1
	isPrivate := false
	isPublic := false

	for _, policy := range policies {
		// Check no-store and no-cache first
		if policy.RespDirectives.NoStore {
			result.RespDirectives.NoStore = true
			return &result, "no-store"
		}
		if policy.RespDirectives.NoCachePresent {
			result.RespDirectives.NoCachePresent = true
		}

		// Determine the shortest max-age if available
		if policy.RespDirectives.MaxAge > 0 && (minMaxAge == -1 || policy.RespDirectives.MaxAge < minMaxAge) {
			minMaxAge = policy.RespDirectives.MaxAge
		}

		// Track if any policy specifies "private"
		if policy.RespDirectives.PrivatePresent {
			isPrivate = true
		} else if policy.RespDirectives.Public {
			isPublic = true
		}

		// Handle expires header comparisons
		if policy.RespExpiresHeader.Before(result.RespExpiresHeader) || result.RespExpiresHeader.IsZero() {
			result.RespExpiresHeader = policy.RespExpiresHeader
		}
	}

	// Set the calculated max-age and privacy level on the result
	if minMaxAge > 0 {
		result.RespDirectives.MaxAge = minMaxAge
	}
	result.RespDirectives.PrivatePresent = isPrivate

	// Format the final Cache-Control header
	headerParts := []string{}
	if result.RespDirectives.NoCachePresent {
		headerParts = append(headerParts, noCache)
	} else if minMaxAge > 0 {
		headerParts = append(headerParts, fmt.Sprintf("max-age=%d", minMaxAge))
	}
	if isPrivate {
		headerParts = append(headerParts, "private")
	} else if isPublic {
		headerParts = append(headerParts, "public")
	}
	cacheControlHeader := strings.Join(headerParts, ", ")

	return &result, cacheControlHeader
}

// SubgraphRules returns the list of header rules for the subgraph with the given name.
// Rules are returned in evaluation order: `all` first, then any matching groups (in
// config order, list-or-regex match), then exact-name rules. Groups whose `matching`
// regex fails to compile here are skipped silently — startup-time validation in
// NewHeaderPropagation is the source of truth for failing the router on bad
// configuration. The engine's pre-origin layer uses this helper to compute the static
// set of "potentially propagated" header names; missing group rules here would
// cause the engine to drop those names from its single-flight key.
func SubgraphRules(rules *config.HeaderRules, subgraphName string) []*config.RequestHeaderRule {
	if rules == nil {
		return nil
	}
	var subgraphRules []*config.RequestHeaderRule
	if rules.All != nil {
		subgraphRules = append(subgraphRules, rules.All.Request...)
	}
	if subgraphName != "" && len(rules.Groups) > 0 {
		applied := make([]bool, len(rules.Groups))
		// First mark groups whose explicit `subgraphs` list contains the name.
		for i, g := range rules.Groups {
			if g == nil {
				continue
			}
			for _, s := range g.Subgraphs {
				if s == subgraphName {
					applied[i] = true
					break
				}
			}
		}
		// Then walk in config order, filling in regex matches and emitting rules.
		for i, g := range rules.Groups {
			if g == nil || len(g.Request) == 0 {
				continue
			}
			if !applied[i] {
				if g.Matching == "" {
					continue
				}
				re, err := regexp.Compile(g.Matching)
				if err != nil {
					continue
				}
				matched := re.MatchString(subgraphName)
				if g.NegateMatch {
					matched = !matched
				}
				if !matched {
					continue
				}
				applied[i] = true
			}
			subgraphRules = append(subgraphRules, g.Request...)
		}
	}
	if rules.Subgraphs != nil {
		if subgraphSpecificRules, ok := rules.Subgraphs[subgraphName]; ok {
			subgraphRules = append(subgraphRules, subgraphSpecificRules.Request...)
		}
	}
	return subgraphRules
}

// FetchURLRules returns the list of header rules for first subgraph that matches the given URL
func FetchURLRules(rules *config.HeaderRules, subgraphs []*nodev1.Subgraph, routingURL string) []*config.RequestHeaderRule {
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
func PropagatedHeaders(rules []*config.RequestHeaderRule) (headerNames []string, headerNameRegexps []graphql_datasource.RegularExpression, err error) {
	for _, rule := range rules {
		switch rule.Operation {
		case config.HeaderRuleOperationSet:
			if rule.Name == "" || (rule.Value == "" && rule.ValueFrom == nil && rule.Expression == "") {
				return nil, nil, fmt.Errorf("invalid header set rule %+v, no header name/value combination", rule)
			}
			headerNames = append(headerNames, rule.Name)
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				// Header Names are case insensitive: https://www.w3.org/Protocols/rfc2616/rfc2616.html
				re, err := regexp.Compile(caseInsensitiveRegexp + rule.Matching)
				if err != nil {
					return nil, nil, fmt.Errorf("error compiling regular expression %q in header rule %+v: %w", rule.Matching, rule, err)
				}
				headerNameRegexps = append(headerNameRegexps, graphql_datasource.RegularExpression{
					Pattern:     re,
					NegateMatch: rule.NegateMatch,
				})
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
