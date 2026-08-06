// Package log_operations_with_validation_errors provides a custom module that
// logs a warning for every operation the router rejects with validation errors,
// so that previously working but spec-invalid operations can be collected
// (e.g. after upgrading to a router that validates operations before variable
// extraction, see Pylon issue #3351).
//
// The module is disabled by default. It only logs when it is explicitly
// enabled through the router configuration:
//
//	modules:
//	  logOperationsWithValidationErrors:
//	    enabled: true
package log_operations_with_validation_errors

import (
	"errors"
	"net/http"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const ModuleID = "logOperationsWithValidationErrors"

type LogOperationsWithValidationErrors struct {
	// Enabled activates the warning logs. It is decoded from the module's
	// section of the router configuration and defaults to false.
	Enabled bool `mapstructure:"enabled"`
}

// RouterOnRequest wraps the pre-handler, which is where operations are parsed
// and validated. A RouterMiddlewareHandler would not work here: it is mounted
// after the pre-handler, and the pre-handler aborts the chain when it rejects
// an operation, so the middleware would never observe the rejection.
func (m *LogOperationsWithValidationErrors) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())

	if !m.Enabled {
		return
	}

	// Operations rejected as invalid GraphQL documents (schema validation, but
	// also parsing and normalization failures) carry a core.ReportError. Other
	// request errors (authentication, variable values, execution, ...) don't
	// and are not logged here.
	var reportErr core.ReportError
	if !errors.As(ctx.Error(), &reportErr) {
		return
	}

	externalErrors := reportErr.Report().ExternalErrors
	if len(externalErrors) == 0 {
		return
	}

	validationErrors := make([]string, len(externalErrors))
	for i, externalError := range externalErrors {
		validationErrors[i] = externalError.Message
	}

	ctx.Logger().Warn("Operation rejected with validation errors",
		zap.String("operation_name", ctx.Operation().Name()),
		zap.Strings("validation_errors", validationErrors),
	)
}

func (m *LogOperationsWithValidationErrors) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       ModuleID,
		Priority: 1,
		New: func() core.Module {
			return &LogOperationsWithValidationErrors{}
		},
	}
}

// Interface guard
var _ core.RouterOnRequestHandler = (*LogOperationsWithValidationErrors)(nil)
