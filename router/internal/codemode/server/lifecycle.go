package server

import (
	"context"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/tsgen"
	"github.com/wundergraph/cosmo/router/internal/codemode/yoko"
	"github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type BuildOptions struct {
	Config           config.MCPCodeModeConfiguration
	SessionStateless bool
	RouterGraphQLURL string
	Logger           *zap.Logger
	TracerProvider   trace.TracerProvider
	MeterProvider    metric.MeterProvider

	// RedisProvider is the resolved storage_providers.redis entry referenced by
	// cfg.NamedOps.Storage.ProviderID. When nil, the in-memory backend is used.
	// Provider lookup (and the "unknown id" error) is performed by the router.
	RedisProvider *config.RedisStorageProvider
	// RedisFactory is an optional override used by tests. When nil, the default
	// rediscloser.NewRedisCloser is used.
	RedisFactory func(opts *rediscloser.RedisCloserOptions) (rediscloser.RDCloser, error)
}

func BuildFromConfig(opts BuildOptions) (*Server, error) {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	cfg := opts.Config
	if !cfg.Enabled {
		return New(Config{
			ListenAddr:        cfg.Server.ListenAddr,
			CodeModeEnabled:   cfg.Enabled,
			NamedOpsEnabled:   cfg.NamedOps.Enabled,
			SessionStateless:  opts.SessionStateless,
			ExecuteTimeout:    cfg.ExecuteTimeout,
			MaxResultBytes:    cfg.MaxResultBytes,
			Logger:            logger,
			TracerProvider:    opts.TracerProvider,
			MeterProvider:     opts.MeterProvider,
			ApprovalGate:      sandbox.AutoApprove,
			CallTraceRecorder: nil,
		})
	}

	renderer := tsgen.Adapter(nil, cfg.NamedOps.MaxBundleBytes)
	store, err := buildStorage(cfg, renderer, opts, logger)
	if err != nil {
		return nil, err
	}

	sbx, err := sandbox.New(sandbox.Config{
		RouterGraphQLEndpoint: opts.RouterGraphQLURL,
		RequestTimeout:        cfg.Sandbox.Timeout,
		MemoryLimitBytes:      cfg.Sandbox.MaxMemoryMB * 1024 * 1024,
		MaxInputSizeBytes:     cfg.Sandbox.MaxInputSizeBytes,
		MaxOutputSizeBytes:    cfg.Sandbox.MaxOutputSizeBytes,
		MaxResultBytes:        cfg.MaxResultBytes,
		StorageLookup: func(ctx context.Context, sessionID string, name string) (storage.SessionOp, bool, error) {
			if store == nil {
				return storage.SessionOp{}, false, nil
			}
			return store.GetOp(ctx, sessionID, name)
		},
		Logger: logger,
	})
	if err != nil {
		return nil, fmt.Errorf("create code mode sandbox: %w", err)
	}

	return New(Config{
		ListenAddr:        cfg.Server.ListenAddr,
		CodeModeEnabled:   cfg.Enabled,
		NamedOpsEnabled:   cfg.NamedOps.Enabled,
		SessionStateless:  opts.SessionStateless,
		Storage:           store,
		Pipeline:          &harness.Pipeline{Sandbox: sbx, MaxInputBytes: cfg.Sandbox.MaxInputSizeBytes, MaxResultBytes: cfg.MaxResultBytes},
		YokoClient:        buildYokoClient(cfg.QueryGeneration, logger),
		BundleRenderer:    renderer,
		ExecuteTimeout:    cfg.ExecuteTimeout,
		MaxResultBytes:    cfg.MaxResultBytes,
		ApprovalGate:      buildApprovalGate(cfg, logger),
		Logger:            logger,
		MeterProvider:     opts.MeterProvider,
		TracerProvider:    opts.TracerProvider,
		CallTraceRecorder: nil,
	})
}

func buildStorage(cfg config.MCPCodeModeConfiguration, renderer storage.Renderer, opts BuildOptions, logger *zap.Logger) (storage.SessionStorage, error) {
	if !cfg.NamedOps.Enabled {
		return nil, nil
	}

	if opts.RedisProvider == nil {
		return storage.NewMemoryBackend(storage.MemoryConfig{
			SessionTTL:     cfg.NamedOps.SessionTTL,
			MaxSessions:    cfg.NamedOps.MaxSessions,
			MaxBundleBytes: cfg.NamedOps.MaxBundleBytes,
			Renderer:       renderer,
		}), nil
	}

	factory := opts.RedisFactory
	if factory == nil {
		factory = rediscloser.NewRedisCloser
	}
	client, err := factory(&rediscloser.RedisCloserOptions{
		Logger:         logger,
		URLs:           opts.RedisProvider.URLs,
		ClusterEnabled: opts.RedisProvider.ClusterEnabled,
	})
	if err != nil {
		return nil, fmt.Errorf("create code mode redis storage client: %w", err)
	}
	backend, err := storage.NewRedisBackend(storage.RedisConfig{
		Client:     client,
		KeyPrefix:  cfg.NamedOps.Storage.KeyPrefix,
		SessionTTL: cfg.NamedOps.SessionTTL,
		Renderer:   renderer,
		Logger:     logger,
	})
	if err != nil {
		return nil, fmt.Errorf("create code mode redis storage backend: %w", err)
	}
	return backend, nil
}

func buildYokoClient(cfg config.MCPCodeModeQueryGenConfig, logger *zap.Logger) *yoko.Client {
	if !cfg.Enabled {
		return nil
	}
	client := &http.Client{Timeout: cfg.Timeout}
	if token := cfg.Auth.StaticToken; cfg.Auth.Type == "" || cfg.Auth.Type == "static" {
		if token != "" {
			client.Transport = staticBearerRoundTripper{
				token: token,
				next:  http.DefaultTransport,
			}
		}
	} else if cfg.Auth.Type == "jwt" {
		logger.Warn("code mode query generation jwt auth is not implemented; proceeding without auth")
	}
	return yoko.New(client, cfg.Endpoint, logger)
}

func buildApprovalGate(cfg config.MCPCodeModeConfiguration, _ *zap.Logger) sandbox.ApprovalGate {
	if cfg.RequireMutationApproval {
		return nil
	}
	return sandbox.AutoApprove
}

type staticBearerRoundTripper struct {
	token string
	next  http.RoundTripper
}

func (t staticBearerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	next := t.next
	if next == nil {
		next = http.DefaultTransport
	}
	cloned := req.Clone(req.Context())
	cloned.Header = req.Header.Clone()
	cloned.Header.Set("Authorization", "Bearer "+t.token)
	return next.RoundTrip(cloned)
}
