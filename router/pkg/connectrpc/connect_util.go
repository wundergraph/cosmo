package connectrpc

import (
	"net/http"

	"connectrpc.com/connect"
)

// HTTPStatusToConnectCode maps HTTP status codes to Connect error codes.
// Based on Connect RPC specification and common HTTP status code semantics.
func HTTPStatusToConnectCode(statusCode int) connect.Code {
	switch statusCode {
	case http.StatusBadRequest: // 400
		return connect.CodeInvalidArgument
	case http.StatusUnauthorized: // 401
		return connect.CodeUnauthenticated
	case http.StatusForbidden: // 403
		return connect.CodePermissionDenied
	case http.StatusNotFound: // 404
		return connect.CodeNotFound
	case http.StatusConflict: // 409
		return connect.CodeAborted
	case http.StatusPreconditionFailed: // 412
		return connect.CodeFailedPrecondition
	case http.StatusRequestEntityTooLarge: // 413
		return connect.CodeResourceExhausted
	case http.StatusRequestedRangeNotSatisfiable: // 416
		return connect.CodeOutOfRange
	case http.StatusTooManyRequests: // 429
		return connect.CodeResourceExhausted
	case http.StatusRequestTimeout: // 408
		return connect.CodeDeadlineExceeded
	case http.StatusGatewayTimeout: // 504
		return connect.CodeDeadlineExceeded
	case http.StatusNotImplemented: // 501
		return connect.CodeUnimplemented
	case http.StatusServiceUnavailable: // 503
		return connect.CodeUnavailable
	case http.StatusInternalServerError: // 500
		return connect.CodeInternal
	default:
		// For any other status code (including 2xx success codes),
		// return CodeUnknown as a safe default
		return connect.CodeUnknown
	}
}

// ConnectCodeToHTTPStatus maps Connect error codes to HTTP status codes.
// This is the inverse of HTTPStatusToConnectCode.
func ConnectCodeToHTTPStatus(code connect.Code) int {
	switch code {
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest // 400
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized // 401
	case connect.CodePermissionDenied:
		return http.StatusForbidden // 403
	case connect.CodeNotFound:
		return http.StatusNotFound // 404
	case connect.CodeAborted:
		return http.StatusConflict // 409
	case connect.CodeFailedPrecondition:
		return http.StatusPreconditionFailed // 412
	case connect.CodeResourceExhausted:
		return http.StatusTooManyRequests // 429
	case connect.CodeOutOfRange:
		return http.StatusRequestedRangeNotSatisfiable // 416
	case connect.CodeDeadlineExceeded:
		return http.StatusGatewayTimeout // 504
	case connect.CodeUnimplemented:
		return http.StatusNotImplemented // 501
	case connect.CodeUnavailable:
		return http.StatusServiceUnavailable // 503
	case connect.CodeInternal:
		return http.StatusInternalServerError // 500
	default:
		// For unknown codes or other errors, return 500
		return http.StatusInternalServerError // 500
	}
}
