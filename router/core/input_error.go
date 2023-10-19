package core

type InputError interface {
	error
	// Message represents a human readable error message to be sent to the client/user
	Message() string
}

var _ InputError = (*inputError)(nil)

type inputError struct {
	message string
}

func (e *inputError) Error() string {
	return e.message
}

func (e *inputError) Message() string {
	return e.message
}
