package errs

import "errors"

// config poller errors
var (
	ErrConfigNotModified    = errors.New("config not modified")
	ErrRouterConfigNotFound = errors.New("router config not found")
)

// CDN errors
var (
	ErrMissingSignatureHeader = errors.New("signature header not found in CDN response")
	ErrInvalidSignature       = errors.New("invalid config signature, potential tampering detected")
	ErrFileNotFound           = errors.New("file not found")
)
