package testutil

import (
	"strings"
)

// ParseWWWAuthenticateParams parses the WWW-Authenticate header from HTTP responses.
// This is a simple parser for test validation only, not production use.
//
// NOTE: LLM-generated - there are no well-established Go libraries for parsing
// WWW-Authenticate response headers (as of 2026). This parser handles the
// common case of Bearer authentication with quoted parameter values.
//
// Example input: `Bearer error="insufficient_scope", scope="read write", resource_metadata="https://example.com"`
// Example output: map[string]string{"error": "insufficient_scope", "scope": "read write", "resource_metadata": "https://example.com"}
func ParseWWWAuthenticateParams(header string) map[string]string {
	params := make(map[string]string)

	// Remove "Bearer " prefix
	header = strings.TrimPrefix(header, "Bearer ")
	header = strings.TrimSpace(header)

	// Simple state machine to parse key="value" pairs
	var key, value strings.Builder
	inKey := true
	inQuote := false

	for i := 0; i < len(header); i++ {
		ch := header[i]

		switch {
		case ch == '=' && inKey:
			inKey = false
		case ch == '"' && !inKey:
			// Track quote state but don't add quotes to value
			inQuote = !inQuote
		case ch == ',' && !inQuote:
			if key.Len() > 0 {
				params[strings.TrimSpace(key.String())] = strings.TrimSpace(value.String())
			}
			key.Reset()
			value.Reset()
			inKey = true
		case inKey:
			key.WriteByte(ch)
		default:
			// We're in a value (!inKey) and ch is not a quote (already handled above)
			// Include everything (including spaces) when inside quotes
			if inQuote || ch != ' ' || value.Len() > 0 {
				value.WriteByte(ch)
			}
		}
	}

	// Add final pair
	if key.Len() > 0 {
		params[strings.TrimSpace(key.String())] = strings.TrimSpace(value.String())
	}

	return params
}
