package cors

import (
	"net/http"
	"strings"
)

type cors struct {
	allowAllOrigins  bool
	allowCredentials bool
	allowOriginFunc  func(string) bool
	allowOrigins     []string
	normalHeaders    http.Header
	preflightHeaders http.Header
	wildcardOrigins  [][]string
	handler          http.Handler
}

var (
	maxRecursionDepth = 10 // Safeguard against deep recursion
	DefaultSchemas    = []string{
		"http://",
		"https://",
	}
	ExtensionSchemas = []string{
		"chrome-extension://",
		"safari-extension://",
		"moz-extension://",
		"ms-browser-extension://",
	}
	FileSchemas = []string{
		"file://",
	}
	WebSocketSchemas = []string{
		"ws://",
		"wss://",
	}
)

func newCors(handler http.Handler, config Config) *cors {
	if err := config.Validate(); err != nil {
		panic(err.Error())
	}

	for _, origin := range config.AllowOrigins {
		if origin == "*" {
			config.AllowAllOrigins = true
		}
	}

	return &cors{
		allowOriginFunc:  config.AllowOriginFunc,
		allowAllOrigins:  config.AllowAllOrigins,
		allowCredentials: config.AllowCredentials,
		allowOrigins:     normalize(config.AllowOrigins),
		normalHeaders:    generateNormalHeaders(config),
		preflightHeaders: generatePreflightHeaders(config),
		wildcardOrigins:  config.parseWildcardRules(),
		handler:          handler,
	}
}

func (cors *cors) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if len(origin) == 0 {
		// request is not a CORS request
		cors.handler.ServeHTTP(w, r)
		return
	}
	host := r.Host

	if origin == "http://"+host || origin == "https://"+host {
		// request is not a CORS request but have origin header.
		// for example, use fetch api
		cors.handler.ServeHTTP(w, r)
		return
	}

	if !cors.validateOrigin(origin) {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	if r.Method == "OPTIONS" {
		cors.handlePreflight(w)
		// Wildcard is automatically set when AllowAllOrigins is true
		if !cors.allowAllOrigins {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.WriteHeader(http.StatusNoContent) // Using 204 is better than 200 when the request status is OPTIONS
	} else {
		cors.handleNormal(w)
		// Wildcard is automatically set when AllowAllOrigins is true
		if !cors.allowAllOrigins {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		cors.handler.ServeHTTP(w, r)
	}
}

func (cors *cors) validateOrigin(origin string) bool {
	if cors.allowAllOrigins {
		return true
	}
	for _, value := range cors.allowOrigins {
		if value == origin {
			return true
		}
	}
	if len(cors.wildcardOrigins) > 0 && cors.validateWildcardOrigin(origin) {
		return true
	}
	if cors.allowOriginFunc != nil {
		return cors.allowOriginFunc(origin)
	}
	return false
}

func (cors *cors) validateWildcardOrigin(origin string) bool {
	for _, w := range cors.wildcardOrigins {
		if matchOriginWithRule(origin, w, 0, map[string]bool{}) {
			return true
		}
	}
	return false
}

// Recursive helper function with depth limit and memoization
func matchOriginWithRule(origin string, rule []string, depth int, memo map[string]bool) bool {
	if depth > maxRecursionDepth {
		return false // Exceeded recursion depth
	}

	// Memoization key
	key := origin + "|" + strings.Join(rule, "|")
	if val, exists := memo[key]; exists {
		return val
	}

	if len(rule) == 0 {
		// Successfully matched if origin is also fully consumed
		return origin == ""
	}

	part := rule[0]

	if part == "*" {
		// Try to match the remaining rule by advancing in origin
		for i := 0; i <= len(origin); i++ {
			if matchOriginWithRule(origin[i:], rule[1:], depth+1, memo) {
				memo[key] = true
				return true
			}
		}
		memo[key] = false
		return false
	}

	// Check if the origin starts with the current part
	if strings.HasPrefix(origin, part) {
		// Recursively check the rest of the origin and rule
		result := matchOriginWithRule(origin[len(part):], rule[1:], depth+1, memo)
		memo[key] = result
		return result
	}

	memo[key] = false
	return false
}

func (cors *cors) handlePreflight(w http.ResponseWriter) {
	header := w.Header()
	for key, value := range cors.preflightHeaders {
		header[key] = value
	}
}

func (cors *cors) handleNormal(w http.ResponseWriter) {
	header := w.Header()
	for key, value := range cors.normalHeaders {
		header[key] = value
	}
}
