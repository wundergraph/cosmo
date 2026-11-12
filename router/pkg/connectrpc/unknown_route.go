package connectrpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
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
// the protocol the request's Content-Type announces, falling back to Connect.
func newUnknownRouteHandler(logger *zap.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		message := "method not found: " + r.URL.Path

		logger.Debug("request for unknown RPC route",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path))

		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "application/grpc") {
			// gRPC and gRPC-Web report errors with HTTP 200 and the status in the
			// trailers. With no response body, the trailers go in the headers
			// (a "Trailers-Only" response).
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("Grpc-Status", strconv.Itoa(int(unknownRouteCode)))
			w.Header().Set("Grpc-Message", grpcPercentEncode(message))
			w.WriteHeader(http.StatusOK)
			return
		}

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

// grpcPercentEncode encodes a grpc-message value: every byte outside printable
// ASCII, and '%' itself, becomes %XX.
// See https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#responses
func grpcPercentEncode(msg string) string {
	var sb strings.Builder
	for i := 0; i < len(msg); i++ {
		if c := msg[i]; c >= ' ' && c <= '~' && c != '%' {
			sb.WriteByte(c)
		} else {
			fmt.Fprintf(&sb, "%%%02X", c)
		}
	}
	return sb.String()
}
