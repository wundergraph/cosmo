package invalidation

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
	"go.uber.org/zap"
)

func NewServer(logger *zap.Logger, cfg config.ResponseCacheInvalidationConfig, invalidator responsecaching.Invalidator) (*http.Server, error) {
	if cfg.Endpoint.SharedKey == "" {
		return nil, errors.New("response cache invalidation is enabled but no shared_key is set")
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
