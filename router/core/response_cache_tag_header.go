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
// left untouched; sorted coarsest first only when over maxBytes. One exact
// size allocation for the value either way.
func buildCacheTagHeader(headerTags []string, delimiter string, maxBytes int) string {
	usable := make([]string, 0, len(headerTags))
	for _, headerTag := range headerTags {
		// The delimiter would split it; a control byte would break the header.
		if headerTag == "" || strings.Contains(headerTag, delimiter) || !httpguts.ValidHeaderFieldValue(headerTag) {
			continue
		}
		usable = append(usable, headerTag)
	}

	fit := fitCacheTagCount(usable, delimiter, maxBytes)
	if fit < len(usable) {
		// Counted again: the sort changes which tags come first.
		caching.SortHeaderTags(usable)
		fit = fitCacheTagCount(usable, delimiter, maxBytes)
	}
	return strings.Join(usable[:fit], delimiter)
}

func fitCacheTagCount(headerTags []string, delimiter string, maxBytes int) int {
	size := 0
	for i, headerTag := range headerTags {
		if i > 0 {
			size += len(delimiter)
		}
		size += len(headerTag)
		if size > maxBytes {
			return i
		}
	}
	return len(headerTags)
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
