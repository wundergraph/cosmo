package core

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"os"
)

// buildTLSClientConfig creates a *tls.Config from a TLSClientCertConfiguration.
func buildTLSClientConfig(clientCfg *config.TLSClientCertConfiguration) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: clientCfg.InsecureSkipCaVerification,
	}

	// Load client certificate and key if provided
	if clientCfg.CertificateChain != "" && clientCfg.Key != "" {
		cert, err := tls.LoadX509KeyPair(clientCfg.CertificateChain, clientCfg.Key)
		if err != nil {
			return nil, fmt.Errorf("failed to load client TLS cert and key: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	// Load custom CA for verifying subgraph server certificates
	if clientCfg.CertificateAuthority != "" {
		caCert, err := os.ReadFile(clientCfg.CertificateAuthority)
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

// buildSubgraphTLSConfigs builds the default and per-subgraph TLS configs from raw configuration.
// Returns (defaultClientTLS, perSubgraphTLS, error).
func buildSubgraphTLSConfigs(cfg *config.SubgraphTLSConfiguration) (*tls.Config, map[string]*tls.Config, error) {
	hasAll := (cfg.All.CertificateChain != "" && cfg.All.Key != "") || cfg.All.CertificateAuthority != "" || cfg.All.InsecureSkipCaVerification

	// If no global TLS config is provided and there are no subgraph specific TLS configs
	if !hasAll && len(cfg.Subgraphs) == 0 {
		return nil, nil, nil
	}

	var defaultClientTLS *tls.Config
	perSubgraphTLS := make(map[string]*tls.Config)

	if hasAll {
		defaultTLS, err := buildTLSClientConfig(&cfg.All)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build global subgraph TLS config: %w", err)
		}
		defaultClientTLS = defaultTLS
	}

	for name, sgCfg := range cfg.Subgraphs {
		subgraphTLS, err := buildTLSClientConfig(&sgCfg)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to build TLS config for subgraph %q: %w", name, err)
		}
		perSubgraphTLS[name] = subgraphTLS
	}

	return defaultClientTLS, perSubgraphTLS, nil
}
