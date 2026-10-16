package requestlogger

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/test"
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
		{"log.status == 201 && log.latency > duration('1ms') && log.custom == 'value' && log.log_type == 'request'", true, false},
		{"'CODE' in log.codes && log.enabled && log.missing == nil", true, false},
		{"$env.log.status == 201", true, false},
		{"int(request.header.Get('absent')) > 1", true, true},
		{"log.missing", false, false},
		{"log.missing == true || rand() < 0", false, false},
		{"(log.missing ?? false) || rand() < 0", false, false},
		// A missing key is nil. As the operand of ! or the left operand of && and ||
		// it is an evaluation error that keeps the entry. As the final value it is false.
		{"log.missing || rand() < 0", true, true},
		{"!log.missing", true, true},
		{"rand() < 1 && log.missing", false, false},
		{"rand() < 0 || log.missing", false, false},
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

type countingMarshaler struct{ calls *int }

func (c countingMarshaler) MarshalLogObject(zapcore.ObjectEncoder) error {
	*c.calls++
	return nil
}

func TestFilterBuildsLogOnlyWhenReferenced(t *testing.T) {
	t.Parallel()
	for expression, usesLog := range map[string]bool{
		"request.url.method == 'GET' || rand() < 0.5": false,
		"log.status >= 500":                           true,
		"$env['log'].status >= 500":                   true,
	} {
		filter, err := NewFilter(expression, expr.CreateNewExprManager())
		require.NoError(t, err)
		require.Equal(t, usesLog, filter.usesLog, expression)

		calls := 0
		filter.ShouldLog(zap.NewNop(), nil, "request", []zap.Field{zap.Object("object", countingMarshaler{calls: &calls})})
		require.Equal(t, usesLog, calls == 1, expression)
	}
}

func TestRequestLoggerFilter(t *testing.T) {
	t.Parallel()
	exclude := WithFilter(func(*http.Request, []zap.Field) bool { return false })

	t.Run("suppresses completed requests", func(t *testing.T) {
		t.Parallel()
		core, logs := observer.New(zapcore.DebugLevel)
		handler := New(zap.New(core), exclude)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		handler.ServeHTTP(httptest.NewRecorder(), test.NewRequest(http.MethodGet, "/graphql"))
		require.Zero(t, logs.Len())
	})

	t.Run("always logs panics", func(t *testing.T) {
		t.Parallel()
		core, logs := observer.New(zapcore.DebugLevel)
		handler := New(zap.New(core), exclude)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic(errors.New("boom"))
		}))
		require.Panics(t, func() {
			handler.ServeHTTP(httptest.NewRecorder(), test.NewRequest(http.MethodGet, "/graphql"))
		})
		require.Equal(t, 1, logs.FilterMessage("[Recovery from panic]").Len())
	})
}
