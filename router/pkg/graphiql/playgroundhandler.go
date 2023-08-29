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

func NewPlayground(opts *PlaygroundOptions) http.HandlerFunc {
	fn := func(w http.ResponseWriter, r *http.Request) {
		tpl := strings.Replace(opts.Html, "{{graphqlURL}}", opts.GraphqlURL, -1)
		resp := []byte(tpl)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(len(resp)))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(resp)
	}

	return fn
}
