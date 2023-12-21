package metric

import (
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
	"net/http"
	"strings"
	"time"
	"unicode"
)

// Excluded by default from Prometheus export because of high cardinality
// This would produce a metric series for each unique operation
// Metric must be in snake case because that's how the Prometheus exporter converts them
var defaultExcludedOtelKeys = []attribute.Key{
	otel.WgOperationHash,
}

func ServePrometheus(logger *zap.Logger, listenAddr string, path string, registry *prometheus.Registry) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(path, promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		ErrorLog:          zap.NewStdLog(logger),
		Registry:          registry,
		Timeout:           10 * time.Second,
	}))

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      1 * time.Minute,
		ReadHeaderTimeout: 2 * time.Second,
		IdleTimeout:       30 * time.Second,
		ErrorLog:          zap.NewStdLog(logger),
		Handler:           r,
	}

	logger.Info("Prometheus metrics enabled", zap.String("listen_addr", svr.Addr), zap.String("endpoint", path))

	return svr
}

func sanitizeName(name string) string {
	return strings.Map(sanitizeRune, name)
}

func sanitizeRune(r rune) rune {
	if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ':' || r == '_' {
		return r
	}
	return '_'
}
