package connectrpc

import (
	"net/http"

	"connectrpc.com/connect"
)

// HTTPStatusToConnectCode maps HTTP status codes to Connect error codes.
// Only the cases explicitly listed in the Connect RPC specification are mapped;
// all other status codes (including 500) fall through to CodeUnknown per spec.
// See: https://connectrpc.com/docs/protocol/#error-codes
func HTTPStatusToConnectCode(statusCode int) connect.Code {
	switch statusCode {
	case http.StatusBadRequest: // 400
		return connect.CodeInternal
	case http.StatusUnauthorized: // 401
		return connect.CodeUnauthenticated
	case http.StatusForbidden: // 403
		return connect.CodePermissionDenied
	case http.StatusNotFound: // 404
		return connect.CodeUnimplemented
	case http.StatusConflict: // 409
		return connect.CodeAborted
	case http.StatusTooManyRequests: // 429
		return connect.CodeUnavailable
	case http.StatusBadGateway: // 502
		return connect.CodeUnavailable
	case http.StatusNotImplemented: // 501
		return connect.CodeUnimplemented
	case http.StatusServiceUnavailable: // 503
		return connect.CodeUnavailable
	case http.StatusGatewayTimeout: // 504
		return connect.CodeUnavailable
	default:
		return connect.CodeUnknown
	}
}

// ConnectCodeToHTTPStatus maps Connect error codes to HTTP status codes.
// Based on the Connect RPC specification:
// https://connectrpc.com/docs/protocol/#error-codes
func ConnectCodeToHTTPStatus(code connect.Code) int {
	switch code {
	case connect.CodeCanceled:
		return 408
	case connect.CodeUnknown:
		return http.StatusInternalServerError // 500
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest // 400
	case connect.CodeDeadlineExceeded:
		return 408
	case connect.CodeNotFound:
		return http.StatusNotFound // 404
	case connect.CodeAlreadyExists:
		return http.StatusConflict // 409
	case connect.CodePermissionDenied:
		return http.StatusForbidden // 403
	case connect.CodeResourceExhausted:
		return http.StatusTooManyRequests // 429
	case connect.CodeFailedPrecondition:
		return http.StatusPreconditionFailed // 412
	case connect.CodeAborted:
		return http.StatusConflict // 409
	case connect.CodeOutOfRange:
		return http.StatusBadRequest // 400
	case connect.CodeUnimplemented:
		return http.StatusNotFound // 404
	case connect.CodeInternal:
		return http.StatusInternalServerError // 500
	case connect.CodeUnavailable:
		return http.StatusServiceUnavailable // 503
	case connect.CodeDataLoss:
		return http.StatusInternalServerError // 500
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized // 401
	default:
		return http.StatusInternalServerError // 500
	}
}
