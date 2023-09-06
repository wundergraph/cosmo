package app

import (
	"context"
	"go.uber.org/zap"
	"net/http"
	"sync"
	"time"
)

type key string

const requestContextKey = key("request")

var _ RequestContext = (*requestContext)(nil)

type RequestContext interface {
	// ResponseHeader is a map of headers that will be set on the response.
	ResponseHeader() http.Header

	Logger() *zap.Logger

	// Set is used to store a new key/value pair exclusively for this context.
	Set(string, any)

	// Get returns the value for the given key, ie: (value, true).
	Get(string) (value any, exists bool)

	// GetString returns the value associated with the key as a string.
	GetString(string) string

	// MustGet returns the value for the given key if it exists, otherwise it panics.
	MustGet(string) any

	// GetBool returns the value associated with the key as a boolean.
	GetBool(string) bool

	// GetInt returns the value associated with the key as an integer.
	GetInt(string) int

	// GetInt64 returns the value associated with the key as an integer.
	GetInt64(string) int64

	// GetUint returns the value associated with the key as an unsigned integer.
	GetUint(string) uint

	// GetUint64 returns the value associated with the key as an unsigned integer.
	GetUint64(string) uint64

	// GetFloat64 returns the value associated with the key as a float64.
	GetFloat64(string) float64

	// GetTime returns the value associated with the key as time.
	GetTime(string) time.Time

	// GetDuration returns the value associated with the key as a duration.
	GetDuration(string) time.Duration

	// GetStringSlice returns the value associated with the key as a slice of strings.
	GetStringSlice(string) []string

	// GetStringMap returns the value associated with the key as a map of interfaces.
	GetStringMap(string) map[string]any

	// GetStringMapString returns the value associated with the key as a map of strings.
	GetStringMapString(string) map[string]string

	// GetStringMapStringSlice returns the value associated with the key as a map to a slice of strings.
	GetStringMapStringSlice(string) map[string][]string
}

// requestContext is the default implementation of RequestContext
// It is accessible to custom modules in the request lifecycle
type requestContext struct {
	logger *zap.Logger
	// This mutex protects keys map.
	mu sync.RWMutex
	// keys is a key/value pair exclusively for the context of each request.
	keys map[string]any
	// ResponseHeader is a map of headers that will be set on the response.
	responseHeader http.Header
}

func NewContext(logger *zap.Logger, responseHeader http.Header) *requestContext {
	return &requestContext{
		logger:         logger,
		responseHeader: responseHeader,
	}
}

func WithRequestContext(ctx context.Context, operation *requestContext) context.Context {
	return context.WithValue(ctx, requestContextKey, operation)
}

// GetRequestContext returns the request context.
// It provides access to the original Request and ResponseWriter.
func GetRequestContext(ctx context.Context) RequestContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(requestContextKey)
	if op == nil {
		return nil
	}
	return op.(RequestContext)
}

func (c *requestContext) ResponseHeader() http.Header {
	return c.responseHeader
}

func (c *requestContext) Logger() *zap.Logger {
	return c.logger
}

// Set is used to store a new key/value pair exclusively for this context.
// It also lazy initializes  c.keys if it was not used previously.
func (c *requestContext) Set(key string, value any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.keys == nil {
		c.keys = make(map[string]any)
	}

	c.keys[key] = value
}

// Get returns the value for the given key, ie: (value, true).
// If the value does not exist it returns (nil, false)
func (c *requestContext) Get(key string) (value any, exists bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	value, exists = c.keys[key]
	return
}

// MustGet returns the value for the given key if it exists, otherwise it panics.
func (c *requestContext) MustGet(key string) any {
	if value, exists := c.Get(key); exists {
		return value
	}
	panic("Key \"" + key + "\" does not exist")
}

// GetString returns the value associated with the key as a string.
func (c *requestContext) GetString(key string) (s string) {
	if val, ok := c.Get(key); ok && val != nil {
		s, _ = val.(string)
	}
	return
}

// GetBool returns the value associated with the key as a boolean.
func (c *requestContext) GetBool(key string) (b bool) {
	if val, ok := c.Get(key); ok && val != nil {
		b, _ = val.(bool)
	}
	return
}

// GetInt returns the value associated with the key as an integer.
func (c *requestContext) GetInt(key string) (i int) {
	if val, ok := c.Get(key); ok && val != nil {
		i, _ = val.(int)
	}
	return
}

// GetInt64 returns the value associated with the key as an integer.
func (c *requestContext) GetInt64(key string) (i64 int64) {
	if val, ok := c.Get(key); ok && val != nil {
		i64, _ = val.(int64)
	}
	return
}

// GetUint returns the value associated with the key as an unsigned integer.
func (c *requestContext) GetUint(key string) (ui uint) {
	if val, ok := c.Get(key); ok && val != nil {
		ui, _ = val.(uint)
	}
	return
}

// GetUint64 returns the value associated with the key as an unsigned integer.
func (c *requestContext) GetUint64(key string) (ui64 uint64) {
	if val, ok := c.Get(key); ok && val != nil {
		ui64, _ = val.(uint64)
	}
	return
}

// GetFloat64 returns the value associated with the key as a float64.
func (c *requestContext) GetFloat64(key string) (f64 float64) {
	if val, ok := c.Get(key); ok && val != nil {
		f64, _ = val.(float64)
	}
	return
}

// GetTime returns the value associated with the key as time.
func (c *requestContext) GetTime(key string) (t time.Time) {
	if val, ok := c.Get(key); ok && val != nil {
		t, _ = val.(time.Time)
	}
	return
}

// GetDuration returns the value associated with the key as a duration.
func (c *requestContext) GetDuration(key string) (d time.Duration) {
	if val, ok := c.Get(key); ok && val != nil {
		d, _ = val.(time.Duration)
	}
	return
}

// GetStringSlice returns the value associated with the key as a slice of strings.
func (c *requestContext) GetStringSlice(key string) (ss []string) {
	if val, ok := c.Get(key); ok && val != nil {
		ss, _ = val.([]string)
	}
	return
}

// GetStringMap returns the value associated with the key as a map of interfaces.
func (c *requestContext) GetStringMap(key string) (sm map[string]any) {
	if val, ok := c.Get(key); ok && val != nil {
		sm, _ = val.(map[string]any)
	}
	return
}

// GetStringMapString returns the value associated with the key as a map of strings.
func (c *requestContext) GetStringMapString(key string) (sms map[string]string) {
	if val, ok := c.Get(key); ok && val != nil {
		sms, _ = val.(map[string]string)
	}
	return
}

// GetStringMapStringSlice returns the value associated with the key as a map to a slice of strings.
func (c *requestContext) GetStringMapStringSlice(key string) (smss map[string][]string) {
	if val, ok := c.Get(key); ok && val != nil {
		smss, _ = val.(map[string][]string)
	}
	return
}

// ModuleContext is a type which defines the lifetime of modules that are registered with the router.
type ModuleContext struct {
	context.Context
	module Module
	logger *zap.Logger
}

func (mc ModuleContext) Logger() *zap.Logger {
	return mc.logger.With(zap.String("module", string(mc.module.Module().ID)))
}
