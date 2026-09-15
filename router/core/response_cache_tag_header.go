package core

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
	"golang.org/x/net/http/httpguts"
)

// buildCacheTagHeader: empty when nothing fits. Input is unique already and
// left untouched; sorted coarsest first only when over maxBytes.
func buildCacheTagHeader(headerTags []string, delimiter string, maxBytes int) string {
	usable := make([]string, 0, len(headerTags))
	for _, headerTag := range headerTags {
		// The delimiter would split it; a control byte would break the header.
		if headerTag == "" || strings.Contains(headerTag, delimiter) || !httpguts.ValidHeaderFieldValue(headerTag) {
			continue
		}
		usable = append(usable, headerTag)
	}
	if len(usable) == 0 {
		return ""
	}

	if full := strings.Join(usable, delimiter); len(full) <= maxBytes {
		return full
	}

	caching.SortHeaderTags(usable)

	var b strings.Builder
	for _, headerTag := range usable {
		need := len(headerTag)
		if b.Len() > 0 {
			need += len(delimiter)
		}
		// Stop at the first that does not fit: a finer headerTag after it must not
		// stand in for a coarser one that was cut.
		if b.Len()+need > maxBytes {
			break
		}
		if b.Len() > 0 {
			b.WriteString(delimiter)
		}
		b.WriteString(headerTag)
	}
	return b.String()
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
	return nil
}
