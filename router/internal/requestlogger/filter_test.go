package requestlogger

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestFilter(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		expression string
		want       bool
		diagnostic bool
	}{
		{"", true, false},
		{"false", false, false},
		{"log.status == 201 && log.latency > duration('1ms') && log.custom == 'value' && log.log_type == 'request' && log.pid > 0 && log.hostname != ''", true, false},
		{"'CODE' in log.codes && log.enabled && log.missing == nil", true, false},
		{"int(request.header.Get('absent')) > 1", true, true},
		{"log.missing", false, false},
		{"log.status", true, true},
	} {
		t.Run(tc.expression, func(t *testing.T) {
			filter, err := NewFilter(tc.expression, expr.CreateNewExprManager())
			require.NoError(t, err)
			core, logs := observer.New(zapcore.DebugLevel)
			fields := []zap.Field{zap.Int("status", 201), zap.Duration("latency", time.Second), zap.String("custom", "value"), zap.Strings("codes", []string{"CODE"}), zap.Bool("enabled", true), zap.Skip()}
			require.Equal(t, tc.want, filter.ShouldLog(logging.NewZapLoggerWithCore(core, false, false), nil, "request", fields))
			require.Equal(t, tc.diagnostic, logs.Len() == 1)
		})
	}
}
