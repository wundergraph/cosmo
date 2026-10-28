package core

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
	"go.uber.org/zap"
	"golang.org/x/net/http/httpguts"
)

// cacheTagHeader is cache_tag_header with its tiers looked up once.
type cacheTagHeader struct {
	config.ResponseCacheTagHeaderConfig
	tiers cacheTagTiers
	// metrics is nil while the response cache metrics are off.
	metrics rmetric.ResponseCacheMetricStore
}

// cacheTagTiers is indexed by caching.SurrogateKeyTier.
type cacheTagTiers [caching.SurrogateKeyTierDeclared + 1]bool

var cacheTagTierNames = map[string]caching.SurrogateKeyTier{
	config.ResponseCacheTagTierSubgraph: caching.SurrogateKeyTierSubgraph,
	config.ResponseCacheTagTierType:     caching.SurrogateKeyTierType,
	config.ResponseCacheTagTierCacheTag: caching.SurrogateKeyTierDeclared,
}

// allCacheTagTiers is what the header carried before tiers could be chosen.
var allCacheTagTiers = cacheTagTiers{true, true, true}

// newCacheTagHeader: unset is every tier, truncated, as before either could be chosen.
func newCacheTagHeader(cfg config.ResponseCacheTagHeaderConfig, metrics rmetric.ResponseCacheMetricStore) cacheTagHeader {
	h := cacheTagHeader{ResponseCacheTagHeaderConfig: cfg, metrics: metrics}
	if h.OnOverflow == "" {
		h.OnOverflow = config.ResponseCacheTagHeaderOverflowTruncate
	}
	if len(cfg.Tiers) == 0 {
		h.tiers = allCacheTagTiers
	}
	for _, name := range cfg.Tiers {
		if tier, ok := cacheTagTierNames[name]; ok {
			h.tiers[tier] = true
		}
	}
	return h
}

// set puts the response's tags in header, or on overflow does what on_overflow says.
func (c *cacheTagHeader) set(ctx context.Context, header http.Header, surrogateKeys []caching.SurrogateKey, log *zap.Logger) {
	value, overflow := buildCacheTagHeader(surrogateKeys, c.tiers, c.Delimiter, c.MaxBytes)
	if overflow {
		if c.metrics != nil {
			c.metrics.MeasureTagHeaderOverflow(ctx, string(c.OnOverflow))
		}
		if log != nil {
			log.Debug("Response cache tags did not fit cache_tag_header.max_bytes",
				zap.Int("max_bytes", c.MaxBytes), zap.String("on_overflow", string(c.OnOverflow)))
		}
		if c.OnOverflow == config.ResponseCacheTagHeaderOverflowPrivate {
			// Every line: propagation Adds, so one may already be set.
			header.Set(cacheControlKey, privateCacheControl(strings.Join(header.Values(cacheControlKey), ",")))
			return
		}
	}
	if value != "" {
		header.Set(c.Name, value)
	}
}

// privateCacheControl keeps a response out of shared caches, leaving the
// rest of cacheControl to the client.
func privateCacheControl(cacheControl string) string {
	directives := []string{"private"}
	for directive := range strings.SplitSeq(cacheControl, ",") {
		directive = strings.TrimSpace(directive)
		name, _, _ := strings.Cut(strings.ToLower(directive), "=")
		switch name {
		case "", "private", "public", "s-maxage", "proxy-revalidate":
			continue
		case "no-store":
			return cacheControl
		}
		directives = append(directives, directive)
	}
	return strings.Join(directives, ", ")
}

// buildCacheTagHeader: empty when nothing fits. Keys outside tiers, and ones
// a header cannot carry, are left out; the rest keep their order, one per
// value, sorted coarsest first only when over maxBytes. overflow reports that
// some did not fit.
func buildCacheTagHeader(surrogateKeys []caching.SurrogateKey, tiers cacheTagTiers, delimiter string, maxBytes int) (value string, overflow bool) {
	usable := cacheTagHeaderKeys(surrogateKeys, tiers, delimiter)
	fit := fitCacheTagCount(usable, delimiter, maxBytes)
	if fit < len(usable) {
		// Counted again: the sort changes which tags come first.
		caching.SortSurrogateKeys(usable)
		fit = fitCacheTagCount(usable, delimiter, maxBytes)
	}

	size := 0
	for i, surrogateKey := range usable[:fit] {
		if i > 0 {
			size += len(delimiter)
		}
		size += len(surrogateKey.Value)
	}
	var b strings.Builder
	b.Grow(size)
	for i, surrogateKey := range usable[:fit] {
		if i > 0 {
			b.WriteString(delimiter)
		}
		b.WriteString(surrogateKey.Value)
	}
	return b.String(), fit < len(usable)
}

// cacheTagHeaderKeys is what the header may carry, in a new slice. A value
// in two tiers is one tag, sorted with the coarser.
func cacheTagHeaderKeys(surrogateKeys []caching.SurrogateKey, tiers cacheTagTiers, delimiter string) []caching.SurrogateKey {
	usable := make([]caching.SurrogateKey, 0, len(surrogateKeys))
	var seen map[string]int
	for _, surrogateKey := range surrogateKeys {
		if !tiers[surrogateKey.Tier] || !usableCacheTag(surrogateKey.Value, delimiter) {
			continue
		}
		if seen == nil {
			seen = make(map[string]int, len(surrogateKeys))
		}
		if i, ok := seen[surrogateKey.Value]; ok {
			usable[i].Tier = min(usable[i].Tier, surrogateKey.Tier)
			continue
		}
		seen[surrogateKey.Value] = len(usable)
		usable = append(usable, surrogateKey)
	}
	return usable
}

// usableCacheTag: the delimiter would split it; a control byte would break the header.
func usableCacheTag(surrogateKey, delimiter string) bool {
	return surrogateKey != "" && !strings.Contains(surrogateKey, delimiter) && httpguts.ValidHeaderFieldValue(surrogateKey)
}

func fitCacheTagCount(surrogateKeys []caching.SurrogateKey, delimiter string, maxBytes int) int {
	size := 0
	for i, surrogateKey := range surrogateKeys {
		if i > 0 {
			size += len(delimiter)
		}
		size += len(surrogateKey.Value)
		if size > maxBytes {
			return i
		}
	}
	return len(surrogateKeys)
}

// reservedCacheTagHeaderNames: set after Content-Length, so naming one of
// these would replace framing net/http needs to write the body.
var reservedCacheTagHeaderNames = map[string]struct{}{
	"Content-Length":    {},
	"Content-Type":      {},
	"Transfer-Encoding": {},
}

func validateResponseCacheTagHeader(cfg config.ResponseCacheTagHeaderConfig) error {
	if !cfg.Enabled {
		return nil
	}
	if !httpguts.ValidHeaderFieldName(cfg.Name) {
		return fmt.Errorf("response cache cache_tag_header.name %q is not a valid header name", cfg.Name)
	}
	if _, reserved := reservedCacheTagHeaderNames[http.CanonicalHeaderKey(cfg.Name)]; reserved {
		return fmt.Errorf("response cache cache_tag_header.name %q would replace a header the response depends on", cfg.Name)
	}
	if cfg.Delimiter == "" || !httpguts.ValidHeaderFieldValue(cfg.Delimiter) {
		return fmt.Errorf("response cache cache_tag_header.delimiter %q must be non-empty and valid in a header", cfg.Delimiter)
	}
	if cfg.MaxBytes <= 0 {
		return fmt.Errorf("response cache cache_tag_header.max_bytes is %d, which must be greater than zero", cfg.MaxBytes)
	}
	for _, name := range cfg.Tiers {
		if _, ok := cacheTagTierNames[name]; !ok {
			return fmt.Errorf("response cache cache_tag_header.tiers has unknown tier %q", name)
		}
	}
	switch cfg.OnOverflow {
	case "", config.ResponseCacheTagHeaderOverflowTruncate, config.ResponseCacheTagHeaderOverflowPrivate:
	default:
		return fmt.Errorf("response cache cache_tag_header.on_overflow %q must be truncate or private", cfg.OnOverflow)
	}
	return nil
}
