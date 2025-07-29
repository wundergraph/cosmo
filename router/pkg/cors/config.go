package cors

import (
	"maps"
	"net/http"
	"slices"
)

type cors struct {
	allowAllOrigins  bool
	allowCredentials bool
	allowOriginFunc  func(string) bool
	allowOrigins     []string
	normalHeaders    http.Header
	preflightHeaders http.Header
	wildcardOrigins  []*WildcardPattern
	handler          http.Handler
}

var (
	maxWildcardOriginLength = 4096 // Maximum length of an origin string for it to be eligible for wildcard matching
	DefaultSchemas          = []string{
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
		wildcardOrigins:  config.parseNewWildcardRules(),
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
	if slices.Contains(cors.allowOrigins, origin) {
		return true
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
	// Origin is >4KB, avoid matching it for performance
	if len(origin) > maxWildcardOriginLength {
		return false
	}

	for _, w := range cors.wildcardOrigins {
		if w.Match(origin) {
			return true
		}
	}
	return false
}

func (cors *cors) handlePreflight(w http.ResponseWriter) {
	header := w.Header()
	maps.Copy(header, cors.preflightHeaders)
}

func (cors *cors) handleNormal(w http.ResponseWriter) {
	header := w.Header()
	maps.Copy(header, cors.normalHeaders)
}
