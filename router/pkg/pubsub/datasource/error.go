package datasource

type Error struct {
	Internal  error
	PublicMsg string
}

func (e *Error) Error() string { return e.PublicMsg }

func (e *Error) Unwrap() error { return e.Internal }

func NewError(publicMsg string, cause error) *Error {
	return &Error{
		PublicMsg: publicMsg,
		Internal:  cause,
	}
}
