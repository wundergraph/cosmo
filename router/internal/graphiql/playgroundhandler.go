package graphiql

import (
	"bytes"
	"net/http"
	"strconv"
	"strings"

	"golang.org/x/sync/semaphore"
)

type PlaygroundOptions struct {
	Html             string
	GraphqlURL       string
	PlaygroundPath   string
	ConcurrencyLimit int64
}

type Playground struct {
	next          http.Handler
	opts          *PlaygroundOptions
	templateBytes []byte
	sem           *semaphore.Weighted
}

var (
	defaultLimitUsage = int64(10)
)

func NewPlayground(opts *PlaygroundOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		limit := opts.ConcurrencyLimit
		if limit == 0 {
			limit = defaultLimitUsage
		}
		p := &Playground{
			next: next,
			opts: opts,
			sem:  semaphore.NewWeighted(limit),
		}
		p.initPlayground()
		return p
	}
}

func (p *Playground) initPlayground() {
	tpl := strings.ReplaceAll(p.opts.Html, "{{graphqlURL}}", p.opts.GraphqlURL)
	tpl = strings.ReplaceAll(tpl, "{{playgroundPath}}", p.opts.PlaygroundPath)
	play := []byte(tpl)
	p.templateBytes = play
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

	if err := p.sem.Acquire(r.Context(), 1); err != nil {
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	defer p.sem.Release(1) // Ensure the semaphore slot is released
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(p.templateBytes)))

	w.WriteHeader(http.StatusOK)
	_, _ = bytes.NewBuffer(p.templateBytes).WriteTo(w)
}
