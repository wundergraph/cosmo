package core

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/watcher"
)

// certReloader holds the parsed contents of a cert/key pair and an optional CA
// bundle. reload re-reads the files and swaps the parsed values atomically, so
// the tls callbacks that read them use the new material on the next handshake.
// Open connections keep what they were established with.
type certReloader struct {
	certFile, keyFile, caFile string

	cert atomic.Pointer[tls.Certificate]
	ca   atomic.Pointer[x509.CertPool]
}

// reload parses the files from disk. Every file is parsed before anything is
// swapped in, so on error the previous values all stay in place.
func (c *certReloader) reload() error {
	var (
		cert *tls.Certificate
		pool *x509.CertPool
	)

	if c.certFile != "" {
		pair, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
		if err != nil {
			return fmt.Errorf("failed to load tls cert and key: %w", err)
		}
		cert = &pair
	}
	if c.caFile != "" {
		var err error
		if pool, err = loadCertPool(c.caFile); err != nil {
			return err
		}
	}

	if cert != nil {
		c.cert.Store(cert)
	}
	if pool != nil {
		c.ca.Store(pool)
	}
	return nil
}

func (c *certReloader) paths() []string {
	var paths []string
	for _, p := range []string{c.certFile, c.keyFile, c.caFile} {
		if p != "" {
			paths = append(paths, p)
		}
	}
	return paths
}

// getCertificate is a tls.Config.GetCertificate callback that serves the current cert.
func (c *certReloader) getCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	return c.cert.Load(), nil
}

// getClientCertificate is a tls.Config.GetClientCertificate callback that presents the current cert.
// Like crypto/tls does for a static Certificates list, it sends no certificate when the server
// would not accept this one, so optional client auth against another CA still succeeds.
func (c *certReloader) getClientCertificate(cri *tls.CertificateRequestInfo) (*tls.Certificate, error) {
	cert := c.cert.Load()
	if err := cri.SupportsCertificate(cert); err != nil {
		return &tls.Certificate{}, nil
	}
	return cert, nil
}

// certReloaders collects every certReloader the router created so a single
// watcher can reload all of them.
type certReloaders struct {
	list []*certReloader
}

// add loads the files once and registers them for reloading.
func (s *certReloaders) add(certFile, keyFile, caFile string) (*certReloader, error) {
	c := &certReloader{certFile: certFile, keyFile: keyFile, caFile: caFile}
	if err := c.reload(); err != nil {
		return nil, err
	}
	s.list = append(s.list, c)
	return c, nil
}

// watch polls the registered files and reloads every certReloader when one of
// them changes. It returns without starting anything when nothing is registered.
func (s *certReloaders) watch(ctx context.Context, logger *zap.Logger, interval time.Duration) error {
	var paths []string
	for _, c := range s.list {
		paths = append(paths, c.paths()...)
	}
	if len(paths) == 0 {
		return nil
	}

	ll := logger.With(zap.String("watcher_label", "tls"))

	reloadAll := func() {
		for _, c := range s.list {
			if err := c.reload(); err != nil {
				ll.Error("Failed to reload TLS certificate. Keeping the previous one", zap.Strings("paths", c.paths()), zap.Error(err))
				continue
			}
			ll.Info("Reloaded TLS certificate", zap.Strings("paths", c.paths()))
		}
	}

	// The files were loaded when the router was built. CallbackOnStart loads
	// them again right after the watcher records its baseline, so a rotation in
	// between is not missed.
	w, err := watcher.New(watcher.Options{
		Interval:        interval,
		Logger:          ll,
		Paths:           paths,
		Callback:        reloadAll,
		CallbackOnStart: true,
	})
	if err != nil {
		return fmt.Errorf("failed to create tls watcher: %w", err)
	}

	go func() {
		if err := w(ctx); err != nil && !errors.Is(err, context.Canceled) {
			ll.Error("Error watching TLS certificate files", zap.Error(err))
		}
	}()

	ll.Info("Watching TLS certificate files for changes. New connections will use updated certificates", zap.Strings("paths", paths))

	return nil
}

func loadCertPool(caFile string) (*x509.CertPool, error) {
	caCert, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read CA file: %w", err)
	}
	pool := x509.NewCertPool()
	if ok := pool.AppendCertsFromPEM(caCert); !ok {
		return nil, errors.New("failed to append CA cert to pool")
	}
	return pool, nil
}

// buildTLSClientConfig creates a *tls.Config from a TLSClientCertConfiguration.
// The client certificate is presented through a callback registered with
// reloaders, so a reload applies to new connections. RootCAs has no such
// callback in crypto/tls and is loaded once.
func buildTLSClientConfig(reloaders *certReloaders, clientCfg config.TLSClientCertConfiguration) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: clientCfg.InsecureSkipCaVerification,
	}

	if clientCfg.CertFile != "" && clientCfg.KeyFile != "" {
		cert, err := reloaders.add(clientCfg.CertFile, clientCfg.KeyFile, "")
		if err != nil {
			return nil, err
		}
		tlsConfig.GetClientCertificate = cert.getClientCertificate
	}

	// Load custom CA for verifying subgraph server certificates
	if clientCfg.CaFile != "" {
		caPool, err := loadCertPool(clientCfg.CaFile)
		if err != nil {
			return nil, err
		}
		tlsConfig.RootCAs = caPool
	}

	return tlsConfig, nil
}

// buildSubgraphHTTPTLSConfigs builds the default and per-subgraph TLS configs for HTTP subgraphs
// from raw configuration.
func buildSubgraphHTTPTLSConfigs(reloaders *certReloaders, logger *zap.Logger, cfg *config.HTTPClientTLSConfiguration) (
	*tls.Config, map[string]*tls.Config, error) {
	hasAll := (cfg.GetAll().CertFile != "" && cfg.GetAll().KeyFile != "") ||
		cfg.GetAll().CaFile != "" || cfg.GetAll().InsecureSkipCaVerification

	// If no global TLS config is provided and there are no subgraph specific TLS configs
	if !cfg.Enabled() {
		return nil, nil, nil
	}

	var defaultClientTLS *tls.Config
	perSubgraphTLS := make(map[string]*tls.Config)

	if hasAll {
		if cfg.GetAll().InsecureSkipCaVerification {
			logger.Warn("Global TLS config has InsecureSkipCaVerification enabled. " +
				"This is not recommended for production environments.")
		}

		defaultTLS, err := buildTLSClientConfig(reloaders, cfg.GetAll().TLSClientCertConfiguration)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build global subgraph TLS config: %w", err)
		}
		defaultClientTLS = defaultTLS
	}

	for name, sgCfg := range cfg.GetSubgraphs() {
		if sgCfg.InsecureSkipCaVerification {
			logger.Warn("Subgraph TLS config inherits InsecureSkipCaVerification from "+
				"global config. This is not recommended for production environments.",
				zap.String("subgraph", name))
		}

		subgraphTLS, err := buildTLSClientConfig(reloaders, sgCfg.TLSClientCertConfiguration)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build TLS config for subgraph %q: %w", name, err)
		}
		perSubgraphTLS[name] = subgraphTLS
	}

	return defaultClientTLS, perSubgraphTLS, nil
}

// buildSubgraphGRPCTLSConfigs builds the default and per-subgraph TLS configs for gRPC subgraphs
// from raw configuration.
func buildSubgraphGRPCTLSConfigs(reloaders *certReloaders, logger *zap.Logger, cfg *config.GRPCClientTLSConfiguration) (
	*tls.Config, map[string]*tls.Config, error) {

	var (
		globalCfg *tls.Config
		err       error
	)

	perSubgraphCfgs := make(map[string]*tls.Config, len(cfg.GetSubgraphs()))

	// global config
	if cfg.All.Enabled {
		if cfg.All.InsecureSkipCaVerification {
			logger.Warn("Global TLS config for gRPC subgraphs has InsecureSkipCaVerification enabled. " +
				"This is not recommended for production environments.")
		}

		globalCfg, err = buildTLSClientConfig(reloaders, cfg.All.TLSClientCertConfiguration)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build global subgraph TLS config: %w", err)
		}
	}

	// per subgraph configs
	for sgName, sgCfg := range cfg.Subgraphs {
		if !sgCfg.Enabled {
			perSubgraphCfgs[sgName] = nil
			continue
		}

		if sgCfg.InsecureSkipCaVerification {
			logger.Warn("Subgraph TLS config has InsecureSkipCaVerification enabled."+
				"This is not recommended for production environments.",
				zap.String("subgraph", sgName))

		}

		perSubgraphCfgs[sgName], err = buildTLSClientConfig(reloaders, sgCfg.TLSClientCertConfiguration)
		if err != nil {
			return nil, nil,
				fmt.Errorf("failed to build TLS config for subgraph %q: %w", sgName, err)
		}
	}

	return globalCfg, perSubgraphCfgs, nil
}
