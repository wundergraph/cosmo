package requestlogger

import (
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Filter is compiled once and can be evaluated concurrently for independent entries.
type Filter struct {
	program *vm.Program
}

func NewFilter(expression string, manager *expr.Manager) (*Filter, error) {
	program, err := manager.CompileAccessLogFilter(expression)
	if err != nil || program == nil {
		return nil, err
	}
	return &Filter{program: program}, nil
}

// ShouldLog fails open: bad request data must not silently discard diagnostic logs.
func (f *Filter) ShouldLog(logger *zap.Logger, ctx *expr.Context, logType string, fields []zap.Field) bool {
	if f == nil {
		return true
	}
	encoder := zapcore.NewMapObjectEncoder()
	logging.AddContextFields(logger, encoder)
	encoder.AddString("log_type", logType)
	for _, field := range fields {
		field.AddTo(encoder)
	}
	env := expr.AccessLogContext{Log: encoder.Fields}
	if ctx != nil {
		env.Context = *ctx
	}
	include, err := expr.ResolveAccessLogFilter(f.program, env)
	if err != nil {
		logger.Debug("unable to evaluate access log filter", zap.Error(err))
		return true
	}
	return include
}
