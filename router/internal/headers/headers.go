package headers

// SkippedHeaders are headers that should not be forwarded to downstream services.
// These headers are connection-specific or should be set by the client/server
// rather than being forwarded from the original request.
var SkippedHeaders = map[string]struct{}{
	"Alt-Svc":          {},
	"Connection":       {},
	"Proxy-Connection": {}, // non-standard but still sent by libcurl and rejected by e.g. google

	// Hop-by-hop headers
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection
	"Keep-Alive":          {},
	"Proxy-Authenticate":  {},
	"Proxy-Authorization": {},
	"Te":                  {}, // canonicalized version of "TE"
	"Trailer":             {}, // not Trailers per URL above; https://www.rfc-editor.org/errata_search.php?eid=4522
	"Transfer-Encoding":   {},
	"Upgrade":             {},

	// Content Negotiation. We must never propagate the client headers to the upstream
	// The router has to decide on its own what to send to the upstream
	"Content-Type":     {},
	"Content-Encoding": {},
	"Content-Length":   {},
	"Accept-Encoding":  {},
	"Accept-Charset":   {},
	"Accept":           {},

	// Web Socket negotiation headers. We must never propagate the client headers to the upstream.
	"Sec-Websocket-Extensions": {},
	"Sec-Websocket-Key":        {},
	"Sec-Websocket-Protocol":   {},
	"Sec-Websocket-Version":    {},

	// Additional headers that should not be forwarded
	"Host": {},
}
