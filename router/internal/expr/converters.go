package expr

type WrapError struct {
	Err error
}

func (e *WrapError) Error() string {
	if e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func wrapExprError(err error) error {
	if err == nil {
		return nil
	}
	return &WrapError{err}
}
