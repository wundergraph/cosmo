package metric

import (
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

// Excluded by default from Prometheus export because of high cardinality
// This would produce a metric series for each unique operation
var defaultExcludedOtelKeys = []attribute.Key{
	otel.WgOperationHash,
}

func NewPrometheusServer(logger *zap.Logger, listenAddr string, path string, registry *prometheus.Registry) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	handlerLogger, err := zap.NewStdLogAt(
		logger.With(zap.String("component", "prometheus_handler")),
		zap.ErrorLevel,
	)
	if err != nil {
		logger.Error("Failed to create Prometheus handler logger", zap.Error(err))
		return nil
	}

	serverLogger, err := zap.NewStdLogAt(
		logger.With(zap.String("component", "prometheus_server")),
		zap.ErrorLevel,
	)
	if err != nil {
		logger.Error("Failed to create Prometheus server logger", zap.Error(err))
		return nil
	}

	r.Handle(path, promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		ErrorLog:          handlerLogger,
		Registry:          registry,
		Timeout:           60 * time.Second,
	}))

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      1 * time.Minute,
		ReadHeaderTimeout: 2 * time.Second,
		IdleTimeout:       30 * time.Second,
		ErrorLog:          serverLogger,
		Handler:           r,
	}

	logger.Info("Prometheus metrics enabled", zap.String("listen_addr", svr.Addr), zap.String("endpoint", path))

	return svr
}

func SanitizeName(name string) string {
	return strings.Map(sanitizeRune, name)
}

func sanitizeRune(r rune) rune {
	if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ':' || r == '_' {
		return r
	}
	return '_'
}
