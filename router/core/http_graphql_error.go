package core

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
