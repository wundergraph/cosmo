// Package restsource serves a Cosmo Connect subgraph from inside the router process. Each field of the
// subgraph is answered by one call to a REST API.
package restsource

import (
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

const moduleID = "rest-source"

//go:embed generated/service.proto
var serviceProto string

//go:embed operations.json
var operationsJSON []byte

func init() {
	core.RegisterModule(&Source{})
}

// Source is configured under `modules.<moduleID>` in the router config.
type Source struct {
	// ListenAddr is where the subgraph is served. It must match the subgraph's routing URL in the graph.
	ListenAddr string `mapstructure:"listen_addr"`
	// BaseURL is the REST API the fields are answered from.
	BaseURL string `mapstructure:"base_url"`
	// Timeout bounds each call to the REST API, such as "5s".
	Timeout string `mapstructure:"timeout"`
	// Headers are sent with every call to the REST API, for example Authorization.
	Headers map[string]string `mapstructure:"headers"`
}

const defaultTimeout = 10 * time.Second

var (
	// The router provisions a module again on every config reload, but a port can be bound once, so the
	// listener lives as long as the process and each reload only swaps the upstream settings.
	serveOnce sync.Once
	serveErr  error
	active    atomic.Pointer[upstream]
)

func (m *Source) Provision(ctx *core.ModuleContext) error {
	spec, err := loadSpec(operationsJSON)
	if err != nil {
		return err
	}

	timeout := defaultTimeout
	if m.Timeout != "" {
		timeout, err = time.ParseDuration(m.Timeout)
		if err != nil {
			return fmt.Errorf("modules.%s.timeout: %w", moduleID, err)
		}
	}

	baseURL := m.BaseURL
	if baseURL == "" {
		baseURL = spec.BaseURL
	}
	if baseURL == "" {
		return fmt.Errorf("modules.%s.base_url is not set, and the API description named no server", moduleID)
	}

	active.Store(&upstream{
		baseURL: baseURL,
		headers: m.Headers,
		client:  &http.Client{Timeout: timeout},
	})

	listenAddr := m.ListenAddr
	if listenAddr == "" {
		listenAddr = spec.ListenAddr
	}

	serveOnce.Do(func() {
		serveErr = serve(listenAddr, spec, ctx.Logger)
	})
	return serveErr
}

func serve(listenAddr string, spec *spec, logger *zap.Logger) error {
	server := grpc.NewServer()
	err := registerService(server, serviceProto, spec, func() *upstream {
		return active.Load()
	})
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("modules.%s.listen_addr: %w", moduleID, err)
	}

	logger.Info("Serving the subgraph inside the router", zap.String("listen_addr", listener.Addr().String()))
	go func() {
		if err := server.Serve(listener); err != nil {
			logger.Error("The subgraph server stopped", zap.Error(err))
		}
	}()
	return nil
}

func (m *Source) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &Source{}
		},
	}
}

var _ core.Provisioner = (*Source)(nil)
