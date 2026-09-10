package cors

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"regexp/syntax"
	"strings"
	"time"
)

// Keep in sync with cors.custom_schemas in pkg/config/config.schema.json.
var customSchemaPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://$`)

// Config represents all available options for the middleware.
type Config struct {
	Enabled bool

	AllowAllOrigins bool

	// AllowOrigins is a list of origins a cross-domain request can be executed from.
	// If the special "*" value is present in the list, all origins will be allowed.
	// Default value is []
	AllowOrigins []string

	// MatchOrigins is a list of Go regular expressions matched against the entire
	// origin. An origin is allowed if it matches AllowOrigins or MatchOrigins.
	MatchOrigins []string

	// AllowOriginFunc is a custom function to validate the origin. It take the origin
	// as argument and returns true if allowed or false otherwise. If this option is
	// set, the content of AllowOrigins is ignored.
	AllowOriginFunc func(origin string) bool

	// AllowMethods is a list of methods the client is allowed to use with
	// cross-domain requests. Default value is simple methods (GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS)
	AllowMethods []string

	// AllowHeaders is list of non-simple headers the client is allowed to use with
	// cross-domain requests.
	AllowHeaders []string

	// AllowCredentials indicates whether the request can include user credentials like
	// cookies, HTTP authentication or client side SSL certificates.
	AllowCredentials bool

	// ExposeHeaders indicates which headers are safe to expose to the API of a CORS
	// API specification
	ExposeHeaders []string

	// MaxAge indicates how long (with second-precision) the results of a preflight request
	// can be cached
	MaxAge time.Duration

	// Allows usage of popular browser extensions schemas
	AllowBrowserExtensions bool

	// Allows usage of WebSocket protocol
	AllowWebSockets bool

	// Allows usage of file:// schema (dangerous!) use it only when you 100% sure it's needed
	AllowFiles bool

	// CustomSchemas adds URL schemes such as custom:// to the allowed schemes.
	CustomSchemas []string
}

// AddAllowMethods is allowed to add custom methods
func (c *Config) AddAllowMethods(methods ...string) {
	c.AllowMethods = append(c.AllowMethods, methods...)
}

// AddAllowHeaders is allowed to add custom headers
func (c *Config) AddAllowHeaders(headers ...string) {
	c.AllowHeaders = append(c.AllowHeaders, headers...)
}

// AddExposeHeaders is allowed to add custom expose headers
func (c *Config) AddExposeHeaders(headers ...string) {
	c.ExposeHeaders = append(c.ExposeHeaders, headers...)
}

func (c *Config) getAllowedSchemas() []string {
	allowedSchemas := DefaultSchemas
	if c.AllowBrowserExtensions {
		allowedSchemas = append(allowedSchemas, ExtensionSchemas...)
	}
	if c.AllowWebSockets {
		allowedSchemas = append(allowedSchemas, WebSocketSchemas...)
	}
	if c.AllowFiles {
		allowedSchemas = append(allowedSchemas, FileSchemas...)
	}
	return append(allowedSchemas, c.CustomSchemas...)
}

func (c *Config) validateAllowedSchemas(origin string) bool {
	allowedSchemas := c.getAllowedSchemas()
	for _, schema := range allowedSchemas {
		if len(origin) >= len(schema) && strings.EqualFold(origin[:len(schema)], schema) {
			return true
		}
	}
	return false
}

// Validate is check configuration of user defined.
func (c *Config) Validate() error {
	_, err := c.validate()
	return err
}

func (c *Config) validate() ([]*regexp.Regexp, error) {
	if c.AllowAllOrigins && (c.AllowOriginFunc != nil || len(c.AllowOrigins) > 0 || len(c.MatchOrigins) > 0) {
		return nil, errors.New("conflict settings: all origins are allowed. AllowOriginFunc, AllowOrigins or MatchOrigins is not needed")
	}
	if !c.AllowAllOrigins && c.AllowOriginFunc == nil && len(c.AllowOrigins) == 0 && len(c.MatchOrigins) == 0 {
		return nil, errors.New("conflict settings: all origins disabled")
	}
	for _, schema := range c.CustomSchemas {
		if !customSchemaPattern.MatchString(schema) {
			return nil, fmt.Errorf("bad custom schema %q: must be a URL scheme followed by '://'", schema)
		}
	}
	for _, origin := range c.AllowOrigins {
		// Wildcards bypass scheme validation for backwards compatibility.
		if !strings.Contains(origin, "*") && !c.validateAllowedSchemas(origin) {
			return nil, errors.New("bad origin: origins must contain '*' or include " + strings.Join(c.getAllowedSchemas(), ","))
		}
	}
	var patterns []*regexp.Regexp
	for _, pattern := range c.MatchOrigins {
		// syntax.Perl is the same set of syntax flags used by regexp.Compile.
		parsed, err := syntax.Parse(pattern, syntax.Perl)
		if err != nil {
			return nil, fmt.Errorf("bad origin regex in match_origins %q: %w", pattern, err)
		}
		// Group alternatives and use text anchors so inline multiline flags cannot
		// turn a full-origin match into a match of just one line. Serializing the
		// parsed expression also prevents a trailing \Q from quoting the anchors.
		re, err := regexp.Compile(`\A(?:` + parsed.String() + `)\z`)
		if err != nil {
			return nil, fmt.Errorf("bad origin regex in match_origins %q: %w", pattern, err)
		}
		patterns = append(patterns, re)
	}
	return patterns, nil
}

func (c *Config) parseNewWildcardRules() []*WildcardPattern {
	var wRules []*WildcardPattern

	for _, o := range c.AllowOrigins {
		if !strings.Contains(o, "*") {
			continue
		}

		wp := Compile(o)
		wRules = append(wRules, wp)
	}

	return wRules
}

// DefaultConfig returns a generic default configuration mapped to localhost.
func DefaultConfig() Config {
	return Config{
		Enabled:          true,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}
}

// Default returns the location middleware with default configuration.
func Default() func(h http.Handler) http.Handler {
	config := DefaultConfig()
	config.AllowAllOrigins = true
	return New(config)
}

// New returns the location middleware with user-defined custom configuration.
func New(config Config) func(h http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		return newCors(h, config)
	}
}
