package graphiql

import (
	"go.uber.org/zap"
	"net/http"
	"strconv"
	"strings"
)

type PlaygroundOptions struct {
	Log        *zap.Logger
	Html       string
	GraphqlURL string
}

type Playground struct {
	next http.Handler
	opts *PlaygroundOptions
}

func NewPlayground(opts *PlaygroundOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return &Playground{
			next: next,
			opts: opts,
		}
	}
}

func (p *Playground) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only serve the playground if the request is for text/html
	// This is especially important for Upgrade websocket requests
	// when the graphql endpoint is on the same path as the playground
	if isWsUpgradeRequest(r) || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		p.next.ServeHTTP(w, r)
		return
	}

	tpl := strings.Replace(p.opts.Html, "{{graphqlURL}}", p.opts.GraphqlURL, -1)
	resp := []byte(tpl)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(resp)))

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(resp)
}

func isWsUpgradeRequest(r *http.Request) bool {
	return r.Header.Get("Upgrade") == "websocket"
}
