package core

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// buildTLSClientConfig creates a *tls.Config from a TLSClientCertConfiguration.
func buildTLSClientConfig(clientCfg config.TLSClientCertConfiguration) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: clientCfg.InsecureSkipCaVerification,
	}

	// Load client certificate and key if provided
	if clientCfg.CertFile != "" && clientCfg.KeyFile != "" {
		cert, err := tls.LoadX509KeyPair(clientCfg.CertFile, clientCfg.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load client TLS cert and key: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	// Load custom CA for verifying subgraph server certificates
	if clientCfg.CaFile != "" {
		caCert, err := os.ReadFile(clientCfg.CaFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read client TLS CA file: %w", err)
		}
		caPool := x509.NewCertPool()
		if ok := caPool.AppendCertsFromPEM(caCert); !ok {
			return nil, errors.New("failed to append client TLS CA cert to pool")
		}
		tlsConfig.RootCAs = caPool
	}

	return tlsConfig, nil
}

// buildSubgraphHTTPTLSConfigs builds the default and per-subgraph TLS configs for HTTP subgraphs
// from raw configuration.
func buildSubgraphHTTPTLSConfigs(logger *zap.Logger, cfg *config.HTTPClientTLSConfiguration) (
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

		defaultTLS, err := buildTLSClientConfig(cfg.GetAll().TLSClientCertConfiguration)
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

		subgraphTLS, err := buildTLSClientConfig(sgCfg.TLSClientCertConfiguration)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build TLS config for subgraph %q: %w", name, err)
		}
		perSubgraphTLS[name] = subgraphTLS
	}

	return defaultClientTLS, perSubgraphTLS, nil
}

// buildSubgraphGRPCTLSConfigs builds the default and per-subgraph TLS configs for gRPC subgraphs
// from raw configuration.
func buildSubgraphGRPCTLSConfigs(logger *zap.Logger, cfg *config.GRPCClientTLSConfiguration) (
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

		globalCfg, err = buildTLSClientConfig(cfg.All.TLSClientCertConfiguration)
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

		perSubgraphCfgs[sgName], err = buildTLSClientConfig(sgCfg.TLSClientCertConfiguration)
		if err != nil {
			return nil, nil,
				fmt.Errorf("failed to build TLS config for subgraph %q: %w", sgName, err)
		}
	}

	return globalCfg, perSubgraphCfgs, nil
}
