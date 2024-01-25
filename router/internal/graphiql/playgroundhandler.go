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
	// if not, just pass through to the next handler
	if !strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html") {
		if p.next != nil {
			p.next.ServeHTTP(w, r)
		}
		return
	}

	tpl := strings.Replace(p.opts.Html, "{{graphqlURL}}", p.opts.GraphqlURL, -1)
	resp := []byte(tpl)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(resp)))

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(resp)
}
