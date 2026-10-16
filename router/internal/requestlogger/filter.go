package requestlogger

import (
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Filter is compiled once and can be evaluated concurrently for independent entries.
type Filter struct {
	program *vm.Program
	usesLog bool
}

func NewFilter(expression string, manager *expr.Manager) (*Filter, error) {
	usesLog := &expr.UsesLog{}
	program, err := manager.CompileAccessLogFilter(expression, usesLog)
	if err != nil || program == nil {
		return nil, err
	}
	return &Filter{program: program, usesLog: usesLog.UsesLog}, nil
}

// ShouldLog fails open: bad request data must not silently discard diagnostic logs.
func (f *Filter) ShouldLog(logger *zap.Logger, ctx *expr.Context, logType string, fields []zap.Field) bool {
	if f == nil {
		return true
	}
	env := expr.AccessLogContext{}
	if f.usesLog {
		encoder := zapcore.NewMapObjectEncoder()
		encoder.AddString("log_type", logType)
		for _, field := range fields {
			field.AddTo(encoder)
		}
		env.Log = encoder.Fields
	}
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
