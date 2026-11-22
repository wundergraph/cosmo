// Package grpcsource serves a Cosmo Connect subgraph from inside the router process. Each field of the
// subgraph is answered by one unary call to an existing gRPC service.
package grpcsource

import (
	"crypto/tls"
	_ "embed"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

const moduleID = "grpc-source"

//go:embed generated/service.proto
var serviceProto string

//go:embed upstream.proto
var upstreamProto string

//go:embed operations.json
var operationsJSON []byte

func init() {
	core.RegisterModule(&Source{})
}

// Source is configured under `modules.<moduleID>` in the router config.
type Source struct {
	// ListenAddr is where the subgraph is served. It must match the subgraph's routing URL in the graph.
	ListenAddr string `mapstructure:"listen_addr"`
	// Target is the gRPC service the fields are answered from, such as payroll.internal:443.
	Target string `mapstructure:"target"`
	// TLS dials the target with TLS and the system roots instead of plaintext.
	TLS bool `mapstructure:"tls"`
	// Timeout bounds each call to the gRPC service, such as "5s".
	Timeout string `mapstructure:"timeout"`
	// Headers are sent as metadata with every call to the gRPC service, for example authorization.
	Headers map[string]string `mapstructure:"headers"`

	connection *grpc.ClientConn
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

	target := m.Target
	if target == "" {
		target = spec.Target
	}

	// Without a target the router still boots, and every call says what is missing.
	if target != "" {
		transport := insecure.NewCredentials()
		if m.TLS {
			transport = credentials.NewTLS(&tls.Config{})
		}

		m.connection, err = grpc.NewClient(target, grpc.WithTransportCredentials(transport))
		if err != nil {
			return fmt.Errorf("modules.%s.target: %w", moduleID, err)
		}
	}

	active.Store(&upstream{
		connection: m.connection,
		headers:    m.Headers,
		timeout:    timeout,
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
	err := registerService(server, serviceProto, upstreamProto, spec, func() *upstream {
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

// Cleanup closes the connection when the router stops, which it also does before it reloads its config.
func (m *Source) Cleanup() error {
	if m.connection == nil {
		return nil
	}
	return m.connection.Close()
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

var (
	_ core.Provisioner = (*Source)(nil)
	_ core.Cleaner     = (*Source)(nil)
)
