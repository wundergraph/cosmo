package core

type InputError interface {
	error
	// Message represents a human readable error message to be sent to the client/user
	Message() string
	// StatusCode is the status code to be sent to the client
	StatusCode() int
}

var _ InputError = (*inputError)(nil)

type inputError struct {
	message    string
	statusCode int
}

func (e *inputError) Error() string {
	return e.message
}

func (e *inputError) Message() string {
	return e.message
}

func (e *inputError) StatusCode() int {
	return e.statusCode
}
