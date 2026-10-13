package invalidation

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
	"go.uber.org/zap"
)

const ResponseCacheInvalidationSharedKeyMinLength = 32

func NewServer(logger *zap.Logger, cfg config.ResponseCacheInvalidationConfig, invalidator responsecaching.Invalidator) (*http.Server, error) {
	if cfg.Endpoint.SharedKey == "" {
		return nil, errors.New("response cache invalidation is enabled but no shared_key is set")
	}
	if utf8.RuneCountInString(cfg.Endpoint.SharedKey) < ResponseCacheInvalidationSharedKeyMinLength {
		return nil, errors.New("response cache invalidation shared_key must be at least 32 characters")
	}
	// chi panics on a route that is empty or does not start with a slash, so
	// this is checked here as a configuration error instead.
	if !strings.HasPrefix(cfg.Endpoint.Path, "/") {
		return nil, fmt.Errorf("response cache invalidation path must start with '/', got %q", cfg.Endpoint.Path)
	}

	serverLogger, err := zap.NewStdLogAt(
		logger.With(zap.String("component", "response_cache_invalidation_server")),
		zap.ErrorLevel,
	)
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(cfg.Endpoint.Path, NewHandler(logger, invalidator, cfg))

	svr := &http.Server{
		Addr:              cfg.Endpoint.ListenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      1 * time.Minute,
		ReadHeaderTimeout: 2 * time.Second,
		IdleTimeout:       30 * time.Second,
		ErrorLog:          serverLogger,
		Handler:           r,
	}

	logger.Info("Response cache invalidation enabled",
		zap.String("listen_addr", svr.Addr),
		zap.String("endpoint", cfg.Endpoint.Path),
		zap.Bool("cache_tag_index", cfg.CacheTag),
		zap.Bool("subgraph_index", cfg.Subgraph),
		zap.Bool("type_index", cfg.Type),
	)

	return svr, nil
}
