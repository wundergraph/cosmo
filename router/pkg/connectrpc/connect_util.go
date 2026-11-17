package connectrpc

import (
	"net/http"
	"strings"

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

func (r *GraphQLResponse) ConnectCode() connect.Code {
	code, ok := commonConnectCode(len(r.Errors), func(i int) (connect.Code, bool) {
		return r.errorConnectCode(r.Errors[i].Extensions)
	})
	if !ok {
		return connect.CodeUnknown
	}
	return code
}

func (r *GraphQLResponse) errorConnectCode(extensions map[string]any) (connect.Code, bool) {
	code, _ := extensions["code"].(string)
	if code == "UNAUTHORIZED_FIELD_OR_TYPE" {
		return r.fieldAuthorizationDenialCode(), true
	}
	if c, ok := connectCodeFromGRPCStatusName(code); ok {
		return c, true
	}
	wrappedSubgraphErrors, _ := extensions["errors"].([]any)
	return commonConnectCode(len(wrappedSubgraphErrors), func(i int) (connect.Code, bool) {
		subgraphError, _ := wrappedSubgraphErrors[i].(map[string]any)
		subgraphErrorExtensions, _ := subgraphError["extensions"].(map[string]any)
		return r.errorConnectCode(subgraphErrorExtensions)
	})
}

// fieldAuthorizationDenialCode relies on the router's authorizer recording missing scopes
// only for authenticated requests. Authentication is per request, so without them every
// denial in the response was for a missing token.
func (r *GraphQLResponse) fieldAuthorizationDenialCode() connect.Code {
	if len(r.Extensions.Authorization.MissingScopes) > 0 {
		return connect.CodePermissionDenied
	}
	return connect.CodeUnauthenticated
}

// commonConnectCode returns the code that all n errors map to. It reports false if there
// are no errors, any error has no code, or the errors disagree.
func commonConnectCode(n int, codeAt func(i int) (connect.Code, bool)) (connect.Code, bool) {
	if n == 0 {
		return 0, false
	}
	var code connect.Code
	for i := range n {
		c, ok := codeAt(i)
		if !ok || (i > 0 && c != code) {
			return 0, false
		}
		code = c
	}
	return code, true
}

func connectCodeFromGRPCStatusName(name string) (connect.Code, bool) {
	if name == "" {
		return 0, false
	}
	normalized := strings.ToLower(strings.ReplaceAll(name, "_", ""))
	for c := connect.CodeCanceled; c <= connect.CodeUnauthenticated; c++ {
		if strings.ReplaceAll(c.String(), "_", "") == normalized {
			return c, true
		}
	}
	return 0, false
}
