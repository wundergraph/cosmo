package core

import "net/http"

type HttpError interface {
	error
	// ExtensionCode is the code that should be included in the error extensions
	ExtensionCode() string
	// Message represents a human-readable error message to be sent to the client/user
	Message() string
	// StatusCode is the status code to be sent to the client
	StatusCode() int
}

var _ HttpError = (*httpGraphqlError)(nil)

// httpGraphqlError is an error that can be used to return a custom GraphQL error message and http status code
type httpGraphqlError struct {
	extensionCode string
	message       string
	statusCode    int
	// kind classifies the error, so that the status code of the GraphQL over HTTP spec
	// can be used instead of statusCode when the response is written
	kind errorKind
}

func NewHttpGraphqlError(message, extensionCode string, statusCode int) HttpError {
	return &httpGraphqlError{
		message:       message,
		extensionCode: extensionCode,
		statusCode:    statusCode,
	}
}

func (e *httpGraphqlError) Error() string {
	return e.message
}

func (e *httpGraphqlError) ExtensionCode() string {
	return e.extensionCode
}

func (e *httpGraphqlError) Message() string {
	return e.message
}

func (e *httpGraphqlError) StatusCode() int {
	return e.statusCode
}

type errorKind uint8

const (
	errorKindUnknown errorKind = iota
	errorKindBlocked
	errorKindNotOnSafelist
	errorKindNoIntrospection
	errorKindInvalidOperationName
	errorKindInvalidVariables
	errorKindPersistedQueryNotConfigured
	errorKindInvalidDefer
	errorKindFileUploadDisabled
	errorKindMutationOverGET
)

// specStatusCodes are the status codes of the GraphQL over HTTP spec for each kind of error.
// They are only used when security.use_graphql_over_http_status_codes is enabled.
var specStatusCodes = map[errorKind]int{
	errorKindBlocked:                     http.StatusForbidden,
	errorKindNotOnSafelist:               http.StatusForbidden,
	errorKindNoIntrospection:             http.StatusForbidden,
	errorKindInvalidOperationName:        http.StatusUnprocessableEntity,
	errorKindInvalidVariables:            http.StatusUnprocessableEntity,
	errorKindPersistedQueryNotConfigured: http.StatusUnprocessableEntity,
	errorKindInvalidDefer:                http.StatusNotAcceptable,
	errorKindFileUploadDisabled:          http.StatusUnsupportedMediaType,
	errorKindMutationOverGET:             http.StatusMethodNotAllowed,
}
