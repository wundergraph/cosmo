package httputil

// SkippedHeaders are headers that should not be forwarded to downstream services.
// These headers are connection-specific or should be set by the client/server
// rather than being forwarded from the original request.
var SkippedHeaders = map[string]struct{}{
	"Connection":               {},
	"Keep-Alive":               {},
	"Proxy-Authenticate":       {},
	"Proxy-Authorization":      {},
	"Te":                       {},
	"Trailer":                  {},
	"Transfer-Encoding":        {},
	"Upgrade":                  {},
	"Host":                     {},
	"Content-Length":           {},
	"Content-Type":             {},
	"Accept":                   {},
	"Accept-Encoding":          {},
	"Accept-Charset":           {},
	"Alt-Svc":                  {},
	"Proxy-Connection":         {},
	"Sec-Websocket-Extensions": {},
	"Sec-Websocket-Key":        {},
	"Sec-Websocket-Protocol":   {},
	"Sec-Websocket-Version":    {},
}