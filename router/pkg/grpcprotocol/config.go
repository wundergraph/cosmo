package grpcprotocol

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	ProtocolGRPC       = "grpc"
	ProtocolConnectRPC = "connectrpc"

	EncodingProto = "proto"
	EncodingJSON  = "json"
)

// Validate checks that all config values in a GRPCProtocolConfig are valid.
func Validate(cfg *config.GRPCProtocolConfig) error {
	if cfg == nil {
		return nil
	}
	if cfg.Default != "" && cfg.Default != ProtocolGRPC && cfg.Default != ProtocolConnectRPC {
		return fmt.Errorf("grpc_protocol.default: invalid value %q, must be %q or %q", cfg.Default, ProtocolGRPC, ProtocolConnectRPC)
	}
	if cfg.DefaultEncoding != "" && cfg.DefaultEncoding != EncodingProto && cfg.DefaultEncoding != EncodingJSON {
		return fmt.Errorf("grpc_protocol.default_encoding: invalid value %q, must be %q or %q", cfg.DefaultEncoding, EncodingProto, EncodingJSON)
	}
	for name, sg := range cfg.Subgraphs {
		if sg.Protocol != "" && sg.Protocol != ProtocolGRPC && sg.Protocol != ProtocolConnectRPC {
			return fmt.Errorf("grpc_protocol.subgraphs.%s.protocol: invalid value %q", name, sg.Protocol)
		}
		if sg.Encoding != "" && sg.Encoding != EncodingProto && sg.Encoding != EncodingJSON {
			return fmt.Errorf("grpc_protocol.subgraphs.%s.encoding: invalid value %q", name, sg.Encoding)
		}
	}
	return nil
}

// ResolveProtocol returns the effective protocol for a subgraph.
func ResolveProtocol(cfg *config.GRPCProtocolConfig, subgraphName string) string {
	if cfg == nil {
		return ProtocolGRPC
	}
	if sg, ok := cfg.Subgraphs[subgraphName]; ok && sg.Protocol != "" {
		return sg.Protocol
	}
	if cfg.Default != "" {
		return cfg.Default
	}
	return ProtocolGRPC
}

// ResolveEncoding returns the effective encoding for a subgraph.
func ResolveEncoding(cfg *config.GRPCProtocolConfig, subgraphName string) string {
	if cfg == nil {
		return EncodingProto
	}
	if sg, ok := cfg.Subgraphs[subgraphName]; ok && sg.Encoding != "" {
		return sg.Encoding
	}
	if cfg.DefaultEncoding != "" {
		return cfg.DefaultEncoding
	}
	return EncodingProto
}
