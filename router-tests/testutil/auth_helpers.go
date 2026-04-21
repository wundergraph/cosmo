package testutil

import "strings"

// ParseWWWAuthenticateParams parses the WWW-Authenticate header from HTTP
// responses and returns its auth-params. The auth-scheme (e.g. "Bearer") is
// discarded; callers in these tests only care about the parameters.
//
// Example input: `Bearer error="insufficient_scope", scope="read write"`
// Example output: map[string]string{"error": "insufficient_scope", "scope": "read write"}
//
// The parser below is adapted from containers/image (Apache-2.0):
// https://github.com/containers/image/blob/main/docker/wwwauthenticate.go
// which itself was derived from docker/distribution. Inlined here rather
// than pulled as a dependency — it's ~50 lines and only used by tests.
//
// NOTE: Not fully RFC 7235 compliant; in particular it only handles a single
// challenge per header. Sufficient for asserting on router responses in tests.
func ParseWWWAuthenticateParams(header string) map[string]string {
	_, params := parseValueAndParams(header)
	return params
}

type octetType byte

const (
	isToken octetType = 1 << iota
	isSpace
)

var octetTypes [256]octetType

func init() {
	for c := 0; c < 256; c++ {
		var t octetType
		isCtl := c <= 31 || c == 127
		isChar := c <= 127
		isSeparator := strings.ContainsRune(" \t\"(),/:;<=>?@[]\\{}", rune(c))
		if strings.ContainsRune(" \t\r\n", rune(c)) {
			t |= isSpace
		}
		if isChar && !isCtl && !isSeparator {
			t |= isToken
		}
		octetTypes[c] = t
	}
}

func parseValueAndParams(header string) (value string, params map[string]string) {
	params = make(map[string]string)
	value, s := expectToken(header)
	if value == "" {
		return
	}
	value = strings.ToLower(value)
	s = "," + skipSpace(s)
	for strings.HasPrefix(s, ",") {
		var pkey string
		pkey, s = expectToken(skipSpace(s[1:]))
		if pkey == "" {
			return
		}
		if !strings.HasPrefix(s, "=") {
			return
		}
		var pvalue string
		pvalue, s = expectTokenOrQuoted(s[1:])
		if pvalue == "" {
			return
		}
		params[strings.ToLower(pkey)] = pvalue
		s = skipSpace(s)
	}
	return
}

func skipSpace(s string) string {
	i := 0
	for ; i < len(s); i++ {
		if octetTypes[s[i]]&isSpace == 0 {
			break
		}
	}
	return s[i:]
}

func expectToken(s string) (token, rest string) {
	i := 0
	for ; i < len(s); i++ {
		if octetTypes[s[i]]&isToken == 0 {
			break
		}
	}
	return s[:i], s[i:]
}

func expectTokenOrQuoted(s string) (value, rest string) {
	if !strings.HasPrefix(s, "\"") {
		return expectToken(s)
	}
	s = s[1:]
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"':
			return s[:i], s[i+1:]
		case '\\':
			p := make([]byte, len(s)-1)
			j := copy(p, s[:i])
			escape := true
			for i++; i < len(s); i++ {
				b := s[i]
				switch {
				case escape:
					escape = false
					p[j] = b
					j++
				case b == '\\':
					escape = true
				case b == '"':
					return string(p[:j]), s[i+1:]
				default:
					p[j] = b
					j++
				}
			}
			return "", ""
		}
	}
	return "", ""
}
