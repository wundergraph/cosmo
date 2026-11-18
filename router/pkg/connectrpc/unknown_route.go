package connectrpc

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"
)

var unknownRouteErrorWriter = connect.NewErrorWriter()

// newUnknownRouteHandler answers requests whose path matches no RPC, which the
// transcoder would otherwise answer with a plain text 404.
func newUnknownRouteHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		logger.Debug("request for unknown RPC route", zap.String("method", r.Method), zap.String("path", r.URL.Path))
		message := "method not found: " + r.URL.Path

		// gRPC, gRPC-Web and Connect streaming frame errors over HTTP 200.
		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "application/grpc") || strings.HasPrefix(contentType, "application/connect+") {
			_ = unknownRouteErrorWriter.Write(w, r, connect.NewError(connect.CodeUnimplemented, errors.New(message)))
			return
		}

		// Written by hand to keep the 404; connect-go would send 501.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "unimplemented", "message": message})
	}
}
