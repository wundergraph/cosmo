package cors

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestRouter(config Config) *chi.Mux {
	router := chi.NewRouter()
	if config.Enabled == true {
		router.Use(New(config))
	}
	router.Get("/", func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("get"))
	})
	router.Post("/", func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("post"))
	})
	router.Patch("/", func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("patch"))
	})
	return router
}

func performRequest(r http.Handler, method, origin string) *httptest.ResponseRecorder {
	return performRequestWithHeaders(r, method, origin, http.Header{})
}

func performRequestWithHeaders(r http.Handler, method, origin string, header http.Header) *httptest.ResponseRecorder {
	req, _ := http.NewRequestWithContext(context.Background(), method, "/", nil)
	// From go/net/http/request.go:
	// For incoming requests, the Host header is promoted to the
	// Request.Host field and removed from the Header map.
	req.Host = header.Get("Host")
	header.Del("Host")
	if len(origin) > 0 {
		header.Set("Origin", origin)
	}
	req.Header = header
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestConfigAddAllow(t *testing.T) {
	config := Config{
		Enabled: true,
	}
	config.AddAllowMethods("POST")
	config.AddAllowMethods("GET", "PUT")
	config.AddExposeHeaders()

	config.AddAllowHeaders("Some", " cool")
	config.AddAllowHeaders("header")
	config.AddExposeHeaders()

	config.AddExposeHeaders()
	config.AddExposeHeaders("exposed", "header")
	config.AddExposeHeaders("hey")

	assert.Equal(t, config.AllowMethods, []string{"POST", "GET", "PUT"})
	assert.Equal(t, config.AllowHeaders, []string{"Some", " cool", "header"})
	assert.Equal(t, config.ExposeHeaders, []string{"exposed", "header", "hey"})
}

func TestBadConfig(t *testing.T) {
	assert.Panics(t, func() {
		New(Config{
			Enabled: true,
		})(nil)
	})
	assert.Panics(t, func() {
		New(Config{
			Enabled:         true,
			AllowAllOrigins: true,
			AllowOrigins:    []string{"http://google.com"},
		})(nil)
	})
	assert.Panics(t, func() {
		New(Config{
			Enabled:         true,
			AllowAllOrigins: true,
			AllowOriginFunc: func(origin string) bool { return false },
		})(nil)
	})
	assert.Panics(t, func() {
		New(Config{
			Enabled:      true,
			AllowOrigins: []string{"google.com"},
		})(nil)
	})
}

func TestCustomSchemas(t *testing.T) {
	t.Parallel()

	cases := []struct {
		scheme string
		origin string
	}{
		{scheme: "custom://", origin: "custom://localhost"},
		{scheme: "tauri://", origin: "tauri://localhost"},
		{scheme: "CUSTOM://", origin: "custom://localhost"},
		{scheme: "CuStOm://", origin: "custom://localhost"},
		{scheme: "custom://", origin: "CUSTOM://localhost"},
	}
	for _, tt := range cases {
		t.Run(tt.scheme+"/"+tt.origin, func(t *testing.T) {
			t.Parallel()

			config := Config{AllowOrigins: []string{tt.origin}}
			assert.Error(t, config.Validate())
			config.CustomSchemas = []string{tt.scheme}
			config.AllowOrigins = append(config.AllowOrigins, "http://localhost", "https://localhost")
			assert.NoError(t, config.Validate())
			config.AllowOrigins = []string{"anothercustom://localhost"}
			assert.Error(t, config.Validate())
		})
	}
}

func TestWildcardOriginCompatibility(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		pattern string
		origin  string
	}{
		{name: "HTTP without a scheme", pattern: "*.example.com", origin: "http://app.example.com"},
		{name: "HTTPS without a scheme", pattern: "*.example.com", origin: "https://app.example.com"},
		{name: "custom origin without a scheme", pattern: "*.example.com", origin: "anothercustom://app.example.com"},
		{name: "wildcard scheme", pattern: "*://*.example.com", origin: "anothercustom://app.example.com"},
		{name: "custom scheme without opt-in", pattern: "anothercustom://*.example.com", origin: "anothercustom://app.example.com"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			router := newTestRouter(Config{
				Enabled:      true,
				AllowOrigins: []string{tt.pattern},
			})
			response := performRequest(router, http.MethodPost, tt.origin)
			assert.Equal(t, http.StatusOK, response.Code)
			assert.Equal(t, tt.origin, response.Header().Get("Access-Control-Allow-Origin"))
		})
	}
}

func TestValidateCustomSchemas(t *testing.T) {
	t.Parallel()

	cases := []struct {
		scheme  string
		isValid bool
	}{
		{scheme: "custom://", isValid: true},
		{scheme: "my-app.v2+test://", isValid: true},
		{scheme: "CUSTOM://", isValid: true},
		{scheme: ""},
		{scheme: "custom"},
		{scheme: "custom://host"},
		{scheme: "1custom://"},
		{scheme: "custom_://"},
	}
	for _, tt := range cases {
		t.Run(tt.scheme, func(t *testing.T) {
			t.Parallel()

			config := Config{AllowOrigins: []string{"https://example.com"}, CustomSchemas: []string{tt.scheme}}
			if tt.isValid {
				assert.NoError(t, config.Validate())
			} else {
				assert.ErrorContains(t, config.Validate(), "bad custom schema")
			}
		})
	}
}

func TestCustomOriginRequests(t *testing.T) {
	t.Parallel()

	router := newTestRouter(Config{
		Enabled:       true,
		CustomSchemas: []string{"CUSTOM://"},
		AllowOrigins:  []string{"custom://localhost", "custom://*.example.com"},
		AllowMethods:  []string{http.MethodPost},
	})
	cases := []struct {
		origin  string
		allowed bool
	}{
		{"custom://localhost", true},
		{"custom://app.example.com", true},
		{"custom://other-host", false},
		{"anothercustom://localhost", false},
	}
	for _, tt := range cases {
		for _, method := range []string{http.MethodPost, http.MethodOptions} {
			t.Run(method+"/"+tt.origin, func(t *testing.T) {
				t.Parallel()

				status, allowOrigin := http.StatusForbidden, ""
				if tt.allowed {
					status, allowOrigin = http.StatusOK, tt.origin
					if method == http.MethodOptions {
						status = http.StatusNoContent
					}
				}
				response := performRequestWithHeaders(router, method, tt.origin, http.Header{
					"Access-Control-Request-Method": {http.MethodPost},
				})
				assert.Equal(t, status, response.Code)
				assert.Equal(t, allowOrigin, response.Header().Get("Access-Control-Allow-Origin"))
			})
		}
	}
}

func TestMatchOrigins(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		pattern string
		allowed []string
		denied  []string
	}{
		{
			pattern: `https://([a-z0-9-]+\.)*example\.com`,
			allowed: []string{"https://example.com", "https://app.example.com", "https://a.b.example.com"},
			denied:  []string{"https://app.example.com.evil.com", "https://evil.com/https://app.example.com", "http://app.example.com", "https://appexample.com", "https://app.example.com:443"},
		},
		{
			pattern: `^https://(.+\.)?aol\.(de|ca|co\.uk|com)$`,
			allowed: []string{"https://aol.com", "https://app.aol.co.uk", "https://aol.de", "https://app.aol.ca"},
			denied:  []string{"https://aol.com.evil.com", "https://aol.org", "http://aol.com"},
		},
		{
			pattern: `https://one\.example|https://two\.example`,
			allowed: []string{"https://one.example", "https://two.example"},
			denied:  []string{"https://one.example.evil.com", "https://evil.com/https://two.example"},
		},
		{
			pattern: `(?m)^https://example\.com$`,
			allowed: []string{"https://example.com"},
			denied:  []string{"https://example.com\nhttps://evil.com", "https://evil.com\nhttps://example.com"},
		},
		{
			pattern: `https://\D{1,3}\.example\.com`,
			allowed: []string{"https://APP.example.com", "https://app.example.com"},
			denied:  []string{"https://123.example.com", "https://long.example.com", "https://app.EXAMPLE.com"},
		},
		{
			pattern: `(?i)https://app\.example\.com`,
			allowed: []string{"https://APP.EXAMPLE.COM"},
			denied:  []string{"https://APP.EXAMPLE.COM.evil.com"},
		},
		{
			pattern: `\Qhttps://example.com`,
			allowed: []string{"https://example.com"},
			denied:  []string{"https://example.com.evil.com"},
		},
		{
			pattern: `custom://[a-z]+\.example`,
			allowed: []string{"custom://app.example"},
			denied:  []string{"other://app.example", "custom://app.example.evil.com"},
		},
	} {
		t.Run(tt.pattern, func(t *testing.T) {
			t.Parallel()

			c := newCors(nil, Config{MatchOrigins: []string{tt.pattern}})
			for _, origin := range tt.allowed {
				assert.True(t, c.validateOrigin(origin), origin)
			}
			for _, origin := range tt.denied {
				assert.False(t, c.validateOrigin(origin), origin)
			}
		})
	}
}

func TestInvalidMatchOrigins(t *testing.T) {
	t.Parallel()

	for _, pattern := range []string{`[`, `*`, `https://example\.com(`, `(?=https://)`, `https://example.com)|(?:`} {
		t.Run(pattern, func(t *testing.T) {
			t.Parallel()

			cfg := Config{AllowOrigins: []string{"*"}, MatchOrigins: []string{`https://example\.com`, pattern}}
			err := cfg.Validate()
			require.ErrorContains(t, err, "match_origins")
			assert.Contains(t, err.Error(), fmt.Sprintf("%q", pattern))
			assert.PanicsWithValue(t, err.Error(), func() { New(cfg)(nil) })
		})
	}

	cfg := Config{AllowAllOrigins: true, MatchOrigins: []string{`https://example\.com`}}
	assert.ErrorContains(t, cfg.Validate(), "conflict settings")
}

func TestMatchOriginRequests(t *testing.T) {
	t.Parallel()

	router := newTestRouter(Config{
		Enabled:          true,
		AllowOrigins:     []string{"https://literal.example", "https://*.wildcard.example", "https://literal.example/(foo|bar)"},
		MatchOrigins:     []string{`https://([a-z0-9-]+\.)*example\.com`, `https://app\.example\.org`},
		AllowMethods:     []string{http.MethodPost},
		AllowCredentials: true,
	})
	for _, tt := range []struct {
		origin  string
		allowed bool
	}{
		{"https://example.com", true},
		{"https://app.example.com", true},
		{"https://app.example.org", true},
		{"https://literal.example", true},
		{"https://app.wildcard.example", true},
		{"https://literal.example/(foo|bar)", true},
		{"https://literal.example/foo", false},
		{"https://app.example.com.evil.com", false},
		{"https://evil.com", false},
	} {
		for _, method := range []string{http.MethodPost, http.MethodOptions} {
			t.Run(method+"/"+tt.origin, func(t *testing.T) {
				t.Parallel()

				response := performRequestWithHeaders(router, method, tt.origin, http.Header{
					"Access-Control-Request-Method": {http.MethodPost},
				})
				if !tt.allowed {
					assert.Equal(t, http.StatusForbidden, response.Code)
					assert.Empty(t, response.Header().Get("Access-Control-Allow-Origin"))
					assert.Empty(t, response.Body.String())
					return
				}
				status := http.StatusOK
				if method == http.MethodOptions {
					status = http.StatusNoContent
					assert.Equal(t, "POST", response.Header().Get("Access-Control-Allow-Methods"))
				}
				assert.Equal(t, status, response.Code)
				assert.Equal(t, tt.origin, response.Header().Get("Access-Control-Allow-Origin"))
				assert.Equal(t, "true", response.Header().Get("Access-Control-Allow-Credentials"))
				assert.Contains(t, response.Header().Values("Vary"), "Origin")
			})
		}
	}
}

func TestMatchOriginsWithAllowAllWildcard(t *testing.T) {
	t.Parallel()

	router := newTestRouter(Config{
		Enabled:      true,
		AllowOrigins: []string{"*"},
		MatchOrigins: []string{`https://example\.com`},
	})
	for _, method := range []string{http.MethodPost, http.MethodOptions} {
		response := performRequest(router, method, "https://other.example")
		assert.NotEqual(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "*", response.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestNormalize(t *testing.T) {
	values := normalize([]string{
		"http-Access ", "Post", "POST", " poSt  ",
		"HTTP-Access", "",
	})
	assert.Equal(t, values, []string{"http-access", "post", ""})

	values = normalize(nil)
	assert.Nil(t, values)

	values = normalize([]string{})
	assert.Equal(t, values, []string{})
}

func TestConvert(t *testing.T) {
	methods := []string{"Get", "GET", "get"}
	headers := []string{"X-CSRF-TOKEN", "X-CSRF-Token", "x-csrf-token"}

	assert.Equal(t, []string{"GET", "GET", "GET"}, convert(methods, strings.ToUpper))
	assert.Equal(t, []string{"X-Csrf-Token", "X-Csrf-Token", "X-Csrf-Token"}, convert(headers, http.CanonicalHeaderKey))
}

func TestGenerateNormalHeaders_AllowAllOrigins(t *testing.T) {
	header := generateNormalHeaders(Config{
		Enabled:         true,
		AllowAllOrigins: false,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Origin"), "")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 1)

	header = generateNormalHeaders(Config{
		Enabled:         true,
		AllowAllOrigins: true,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Origin"), "*")
	assert.Equal(t, header.Get("Vary"), "")
	assert.Len(t, header, 1)
}

func TestGenerateNormalHeaders_AllowCredentials(t *testing.T) {
	header := generateNormalHeaders(Config{
		Enabled:          true,
		AllowCredentials: true,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Credentials"), "true")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestGenerateNormalHeaders_ExposedHeaders(t *testing.T) {
	header := generateNormalHeaders(Config{
		Enabled:       true,
		ExposeHeaders: []string{"X-user", "xPassword"},
	})
	assert.Equal(t, header.Get("Access-Control-Expose-Headers"), "X-User,Xpassword")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestGeneratePreflightHeaders(t *testing.T) {
	header := generatePreflightHeaders(Config{
		Enabled:         true,
		AllowAllOrigins: false,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Origin"), "")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 1)

	header = generateNormalHeaders(Config{
		Enabled:         true,
		AllowAllOrigins: true,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Origin"), "*")
	assert.Equal(t, header.Get("Vary"), "")
	assert.Len(t, header, 1)
}

func TestGeneratePreflightHeaders_AllowCredentials(t *testing.T) {
	header := generatePreflightHeaders(Config{
		Enabled:          true,
		AllowCredentials: true,
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Credentials"), "true")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestGeneratePreflightHeaders_AllowMethods(t *testing.T) {
	header := generatePreflightHeaders(Config{
		Enabled:      true,
		AllowMethods: []string{"GET ", "post", "PUT", " put  "},
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Methods"), "GET,POST,PUT")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestGeneratePreflightHeaders_AllowHeaders(t *testing.T) {
	header := generatePreflightHeaders(Config{
		Enabled:      true,
		AllowHeaders: []string{"X-user", "Content-Type"},
	})
	assert.Equal(t, header.Get("Access-Control-Allow-Headers"), "X-User,Content-Type")
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestGeneratePreflightHeaders_MaxAge(t *testing.T) {
	header := generatePreflightHeaders(Config{
		Enabled: true,
		MaxAge:  12 * time.Hour,
	})
	assert.Equal(t, header.Get("Access-Control-Max-Age"), "43200") // 12*60*60
	assert.Equal(t, header.Get("Vary"), "Origin")
	assert.Len(t, header, 2)
}

func TestExtremeLengthOriginKillswitch(t *testing.T) {
	cors := newCors(nil, Config{
		Enabled:      true,
		AllowOrigins: []string{"https://*.google.com"},
	})

	shortSubdomain := strings.Repeat("a", 10)
	longSubdomain := strings.Repeat("a", 500)
	tooLongSubdomain := strings.Repeat("a", 4096)

	assert.True(t, cors.validateOrigin(fmt.Sprintf("https://%s.google.com", shortSubdomain)))
	assert.True(t, cors.validateOrigin(fmt.Sprintf("https://%s.google.com", longSubdomain)))
	assert.False(t, cors.validateOrigin(fmt.Sprintf("https://%s.google.com", tooLongSubdomain)))

	// Should not affect strict origins
	cors = newCors(nil, Config{
		Enabled:      true,
		AllowOrigins: []string{fmt.Sprintf("https://%s.google.com", tooLongSubdomain)},
	})

	assert.True(t, cors.validateOrigin(fmt.Sprintf("https://%s.google.com", tooLongSubdomain)))
}

func TestValidateOrigin(t *testing.T) {
	cors := newCors(nil, Config{
		Enabled:         true,
		AllowAllOrigins: true,
	})
	assert.True(t, cors.validateOrigin("http://google.com"))
	assert.True(t, cors.validateOrigin("https://google.com"))
	assert.True(t, cors.validateOrigin("example.com"))
	assert.True(t, cors.validateOrigin("chrome-extension://random-extension-id"))

	cors = newCors(nil, Config{
		Enabled:      true,
		AllowOrigins: []string{"https://google.com", "https://github.com"},
		AllowOriginFunc: func(origin string) bool {
			return (origin == "http://news.ycombinator.com")
		},
		AllowBrowserExtensions: true,
	})
	assert.False(t, cors.validateOrigin("http://google.com"))
	assert.True(t, cors.validateOrigin("https://google.com"))
	assert.True(t, cors.validateOrigin("https://github.com"))
	assert.True(t, cors.validateOrigin("http://news.ycombinator.com"))
	assert.False(t, cors.validateOrigin("http://example.com"))
	assert.False(t, cors.validateOrigin("google.com"))
	assert.False(t, cors.validateOrigin("chrome-extension://random-extension-id"))

	cors = newCors(nil, Config{
		Enabled:      true,
		AllowOrigins: []string{"https://google.com", "https://github.com"},
	})
	assert.False(t, cors.validateOrigin("chrome-extension://random-extension-id"))
	assert.False(t, cors.validateOrigin("file://some-dangerous-file.js"))
	assert.False(t, cors.validateOrigin("wss://socket-connection"))

	cors = newCors(nil, Config{
		Enabled: true,
		AllowOrigins: []string{
			"chrome-extension://*",
			"safari-extension://my-extension-*-app",
			"*.some-domain.com",
		},
		AllowBrowserExtensions: true,
	})
	assert.True(t, cors.validateOrigin("chrome-extension://random-extension-id"))
	assert.True(t, cors.validateOrigin("chrome-extension://another-one"))
	assert.True(t, cors.validateOrigin("safari-extension://my-extension-one-app"))
	assert.True(t, cors.validateOrigin("safari-extension://my-extension-two-app"))
	assert.False(t, cors.validateOrigin("moz-extension://ext-id-we-not-allow"))
	assert.True(t, cors.validateOrigin("http://api.some-domain.com"))
	assert.False(t, cors.validateOrigin("http://api.another-domain.com"))

	cors = newCors(nil, Config{
		Enabled:         true,
		AllowOrigins:    []string{"file://safe-file.js", "wss://some-session-layer-connection"},
		AllowFiles:      true,
		AllowWebSockets: true,
	})
	assert.True(t, cors.validateOrigin("file://safe-file.js"))
	assert.False(t, cors.validateOrigin("file://some-dangerous-file.js"))
	assert.True(t, cors.validateOrigin("wss://some-session-layer-connection"))
	assert.False(t, cors.validateOrigin("ws://not-what-we-expected"))

	cors = newCors(nil, Config{
		Enabled:      true,
		AllowOrigins: []string{"*"},
	})
	assert.True(t, cors.validateOrigin("http://google.com"))
	assert.True(t, cors.validateOrigin("https://google.com"))
	assert.True(t, cors.validateOrigin("example.com"))
	assert.True(t, cors.validateOrigin("chrome-extension://random-extension-id"))

	// Wildcards
	cors = newCors(nil, Config{
		Enabled: true,
		AllowOrigins: []string{
			"https://*.wgexample.com",
			"https://wgexample.com",
			"https://*.wgexample.io:*",
			"https://*.wgexample.org",
			"https://*.d2grknavcceso7.amplifyapp.com",
		},
	})
	// Matching cases for "*.wgexample.com" wildcard
	assert.True(t, cors.validateOrigin("https://subdomain.wgexample.com"))
	assert.True(t, cors.validateOrigin("https://another.subdomain.wgexample.com"))
	assert.True(t, cors.validateOrigin("https://unauthorized.wgexample.com"))

	assert.True(t, cors.validateOrigin("https://wgexample.com"))

	assert.True(t, cors.validateOrigin("https://subdomain.wgexample.io:443"))
	assert.True(t, cors.validateOrigin("https://api.wgexample.io:8080"))

	assert.True(t, cors.validateOrigin("https://project.wgexample.org"))
	assert.True(t, cors.validateOrigin("https://beta.wgexample.org"))

	assert.True(t, cors.validateOrigin("https://service.d2grknavcceso7.amplifyapp.com"))
	assert.True(t, cors.validateOrigin("https://prod.d2grknavcceso7.amplifyapp.com"))
	assert.True(t, cors.validateOrigin("https://otherdomain.second.d2grknavcceso7.amplifyapp.com"))

	assert.False(t, cors.validateOrigin("https://random.com"))
	assert.False(t, cors.validateOrigin("https://wgexample.io"))
	assert.False(t, cors.validateOrigin("https://wgexample.org"))
	assert.False(t, cors.validateOrigin("http://subdomain.wgexample.com")) // Different scheme (http instead of https)
}

func TestPassesAllowOrigins(t *testing.T) {
	router := newTestRouter(Config{
		Enabled:          true,
		AllowOrigins:     []string{"http://google.com"},
		AllowMethods:     []string{" GeT ", "get", "post", "PUT  ", "Head", "POST"},
		AllowHeaders:     []string{"Content-type", "timeStamp "},
		ExposeHeaders:    []string{"Data", "x-User"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
		AllowOriginFunc: func(origin string) bool {
			return origin == "http://github.com"
		},
	})

	// no CORS request, origin == ""
	w := performRequest(router, "GET", "")
	assert.Equal(t, "get", w.Body.String())
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Empty(t, w.Header().Get("Access-Control-Expose-Headers"))

	// no CORS request, origin == host
	h := http.Header{}
	h.Set("Host", "facebook.com")
	w = performRequestWithHeaders(router, "GET", "http://facebook.com", h)
	assert.Equal(t, "get", w.Body.String())
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Empty(t, w.Header().Get("Access-Control-Expose-Headers"))

	// allowed CORS request
	w = performRequest(router, "GET", "http://google.com")
	assert.Equal(t, "get", w.Body.String())
	assert.Equal(t, "http://google.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "", w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, "Data,X-User", w.Header().Get("Access-Control-Expose-Headers"))

	w = performRequest(router, "GET", "http://github.com")
	assert.Equal(t, "get", w.Body.String())
	assert.Equal(t, "http://github.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "", w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, "Data,X-User", w.Header().Get("Access-Control-Expose-Headers"))

	// deny CORS request
	w = performRequest(router, "GET", "https://google.com")
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Empty(t, w.Header().Get("Access-Control-Expose-Headers"))

	// allowed CORS preflight request
	w = performRequest(router, "OPTIONS", "http://github.com")
	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "http://github.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "", w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, "GET,POST,PUT,HEAD", w.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "Content-Type,Timestamp", w.Header().Get("Access-Control-Allow-Headers"))
	assert.Equal(t, "43200", w.Header().Get("Access-Control-Max-Age"))

	// deny CORS preflight request
	w = performRequest(router, "OPTIONS", "http://example.com")
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Methods"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Headers"))
	assert.Empty(t, w.Header().Get("Access-Control-Max-Age"))
}

func TestPassesAllowAllOrigins(t *testing.T) {
	router := newTestRouter(Config{
		Enabled:          true,
		AllowAllOrigins:  true,
		AllowMethods:     []string{" Patch ", "get", "post", "POST"},
		AllowHeaders:     []string{"Content-type", "  testheader "},
		ExposeHeaders:    []string{"Data2", "x-User2"},
		AllowCredentials: false,
		MaxAge:           10 * time.Hour,
	})

	// no CORS request, origin == ""
	w := performRequest(router, "GET", "")
	assert.Equal(t, "get", w.Body.String())
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Empty(t, w.Header().Get("Access-Control-Expose-Headers"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))

	// allowed CORS request
	w = performRequest(router, "POST", "example.com")
	assert.Equal(t, "post", w.Body.String())
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "Data2,X-User2", w.Header().Get("Access-Control-Expose-Headers"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))

	// allowed CORS prefligh request
	w = performRequest(router, "OPTIONS", "https://facebook.com")
	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "PATCH,GET,POST", w.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "Content-Type,Testheader", w.Header().Get("Access-Control-Allow-Headers"))
	assert.Equal(t, "36000", w.Header().Get("Access-Control-Max-Age"))
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"))
}

func TestWildcard(t *testing.T) {
	router := newTestRouter(Config{
		Enabled:      true,
		AllowOrigins: []string{"https://*.github.com", "https://api.*", "http://*", "https://facebook.com", "*.golang.org"},
		AllowMethods: []string{"GET"},
	})

	w := performRequest(router, "GET", "https://gist.github.com")
	assert.Equal(t, 200, w.Code)

	w = performRequest(router, "GET", "https://api.github.com/v1/users")
	assert.Equal(t, 200, w.Code)

	w = performRequest(router, "GET", "https://giphy.com/")
	assert.Equal(t, 403, w.Code)

	w = performRequest(router, "GET", "http://hard-to-find-http-example.com")
	assert.Equal(t, 200, w.Code)

	w = performRequest(router, "GET", "https://facebook.com")
	assert.Equal(t, 200, w.Code)

	w = performRequest(router, "GET", "https://something.golang.org")
	assert.Equal(t, 200, w.Code)

	w = performRequest(router, "GET", "https://something.go.org")
	assert.Equal(t, 403, w.Code)

	router = newTestRouter(Config{
		Enabled:      true,
		AllowOrigins: []string{"https://github.com", "https://facebook.com"},
		AllowMethods: []string{"GET"},
	})

	w = performRequest(router, "GET", "https://gist.github.com")
	assert.Equal(t, 403, w.Code)

	w = performRequest(router, "GET", "https://github.com")
	assert.Equal(t, 200, w.Code)
}

func TestComplexWildcards(t *testing.T) {
	router := newTestRouter(Config{
		Enabled: true,
		AllowOrigins: []string{
			"https://*.wgexample.com",
			"https://wgexample.com",
			"https://*.wgexample.io:*",
			"https://*.wgexample.org",
			"https://*.d2grknavcceso7.amplifyapp.com",
			"https://*.example.*.*.com", // multiple sequential wildcards
			"https://*.*.*.*.com",
		},
		AllowMethods: []string{"GET"},
	})

	type testCases struct {
		origin       string
		expectedCode int
	}

	testCasesList := []testCases{
		{"https://subdomain.wgexample.com", 200},
		{"https://another.subdomain.wgexample.com", 200},
		{"https://another.wgexample.subdomain.wgexample.com", 200},
		// Specfically test backtracking, to make sure not only greedy solution
		{"https://another.wgexample.subdomain.with.wgexample.wgexample.com", 200},
		// Complex backtracking which should fail in the end
		{"https://another.wgexample.subdomain.with.wgexample.wgexample.io", 403},
		{"https://wgexample.com", 200},
		{"https://subdomain.wgexample.io:443", 200},
		{"https://api.wgexample.io:8080", 200},
		{"https://project.wgexample.org", 200},
		{"https://beta.wgexample.org", 200},
		{"https://service.d2grknavcceso7.amplifyapp.com", 200},
		{"https://prod.d2grknavcceso7.amplifyapp.com", 200},
		{"https://otherdomain.second.d2grknavcceso7.amplifyapp.com", 200},
		{"https://random.com", 403},
		{"https://wgexample.io", 403},
		{"https://wgexample.org", 403},
		{"http://subdomain.wgexample.com", 403},
		{"https://api.example.sub.domain.com", 200},
		{"https://service.example.co.uk.com", 200},
		{"https://api.example.domain.com", 403},
		{"https://a.b.c.d.e.com", 200},
	}
	for _, tc := range testCasesList {
		w := performRequest(router, "GET", tc.origin)
		assert.Equalf(t, tc.expectedCode, w.Code, "expected %d for %s, got %d", tc.expectedCode, tc.origin, w.Code)
	}
}

func TestDisabled(t *testing.T) {
	config := Config{
		Enabled:      true,
		AllowOrigins: []string{"https://api.*"},
		AllowMethods: []string{"GET"},
	}

	router := newTestRouter(config)

	w := performRequest(router, "GET", "https://a.test.com")
	assert.Equal(t, 403, w.Code)

	config.Enabled = false
	router = newTestRouter(config)

	w = performRequest(router, "GET", "https://a.test.com")
	assert.Equal(t, 200, w.Code)
}

func BenchmarkCorsWithWildcards(b *testing.B) {
	b.Run("with wildcards", func(b *testing.B) {
		router := newTestRouter(Config{
			Enabled: true,
			AllowOrigins: []string{
				"https://*.example.*.*.com", // multiple sequential wildcards
				"https://*.*.*.*.com",
			},
			AllowMethods: []string{"GET"},
		})

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			w := performRequest(router, "GET", "https://subdomain.test.example.subdomain.example.co.whatgoeshere.woohoo.com")
			assert.Equal(b, 200, w.Code)
		}
	})

	b.Run("with massive wildcards", func(b *testing.B) {
		router := newTestRouter(Config{
			Enabled: true,
			AllowOrigins: []string{
				"https://*.example.*.*.com", // multiple sequential wildcards
				"https://*.*.*.*.com",
			},
			AllowMethods: []string{"GET"},
		})

		longString := strings.Repeat("a", 50000)

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			w := performRequest(router, "GET", fmt.Sprintf("https://%[1]s.%[1]s.%[1]s.%[1]s.com", longString))
			assert.Equal(b, 200, w.Code)
		}
	})

	b.Run("without wildcards", func(b *testing.B) {
		router := newTestRouter(Config{
			Enabled: true,
			AllowOrigins: []string{
				"https://wgexample.com",
			},
			AllowMethods: []string{"GET"},
		})

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			w := performRequest(router, "GET", "https://wgexample.com")
			assert.Equal(b, 200, w.Code)
		}
	})
}
