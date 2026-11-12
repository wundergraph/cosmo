package connectrpc

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"
)

// unknownRouteCode is the code reported for a path with no registered RPC.
// gRPC specifies UNIMPLEMENTED for an unknown method, and it is also what
// Connect clients infer from a bare HTTP 404, so clients keep seeing the same code.
const unknownRouteCode = connect.CodeUnimplemented

// newUnknownRouteHandler returns the handler the transcoder delegates to when the
// request path matches no registered RPC. Without it the transcoder replies with a
// plain text 404, which clients can't turn into a proper RPC error.
//
// The transcoder hasn't picked a protocol at that point, so the handler answers in
// the protocol the request's Content-Type announces, falling back to unary Connect.
func newUnknownRouteHandler(logger *zap.Logger) http.Handler {
	errorWriter := connect.NewErrorWriter()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		message := "method not found: " + r.URL.Path

		logger.Debug("request for unknown RPC route",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path))

		// gRPC, gRPC-Web and Connect streaming all report errors with HTTP 200
		// and a protocol-specific framing, which connect-go writes for us.
		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "application/grpc") || strings.HasPrefix(contentType, "application/connect+") {
			err := errorWriter.Write(w, r, connect.NewError(unknownRouteCode, errors.New(message)))
			if err != nil {
				logger.Debug("failed to write unknown route response", zap.Error(err))
			}
			return
		}

		// Unary Connect is written here and not by connect-go, which would send
		// HTTP 501 for unimplemented. The router has always answered 404.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(ConnectCodeToHTTPStatus(unknownRouteCode))
		err := json.NewEncoder(w).Encode(map[string]string{
			"code":    unknownRouteCode.String(),
			"message": message,
		})
		if err != nil {
			logger.Debug("failed to write unknown route response", zap.Error(err))
		}
	})
}
