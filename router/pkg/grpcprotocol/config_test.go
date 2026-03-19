package grpcprotocol

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestResolveProtocol_Default(t *testing.T) {
	assert.Equal(t, ProtocolGRPC, ResolveProtocol(&config.GRPCProtocolConfig{}, "any"))
}

func TestResolveProtocol_Nil(t *testing.T) {
	assert.Equal(t, ProtocolGRPC, ResolveProtocol(nil, "any"))
}

func TestResolveProtocol_GlobalDefault(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{Default: ProtocolConnectRPC}
	assert.Equal(t, ProtocolConnectRPC, ResolveProtocol(cfg, "any"))
}

func TestResolveProtocol_PerSubgraphOverride(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{
		Default: ProtocolGRPC,
		Subgraphs: map[string]config.SubgraphGRPCProtocolConfig{
			"rpc-a": {Protocol: ProtocolConnectRPC},
		},
	}
	assert.Equal(t, ProtocolConnectRPC, ResolveProtocol(cfg, "rpc-a"))
	assert.Equal(t, ProtocolGRPC, ResolveProtocol(cfg, "rpc-b"))
}

func TestResolveEncoding_Default(t *testing.T) {
	assert.Equal(t, EncodingProto, ResolveEncoding(&config.GRPCProtocolConfig{}, "any"))
}

func TestResolveEncoding_GlobalDefault(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{DefaultEncoding: EncodingJSON}
	assert.Equal(t, EncodingJSON, ResolveEncoding(cfg, "any"))
}

func TestResolveEncoding_PerSubgraphOverride(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{
		DefaultEncoding: EncodingProto,
		Subgraphs: map[string]config.SubgraphGRPCProtocolConfig{
			"rpc-a": {Encoding: EncodingJSON},
		},
	}
	assert.Equal(t, EncodingJSON, ResolveEncoding(cfg, "rpc-a"))
	assert.Equal(t, EncodingProto, ResolveEncoding(cfg, "rpc-b"))
}

func TestValidate_Valid(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{
		Default:         ProtocolConnectRPC,
		DefaultEncoding: EncodingJSON,
		Subgraphs: map[string]config.SubgraphGRPCProtocolConfig{
			"rpc-a": {Protocol: ProtocolGRPC, Encoding: EncodingProto},
		},
	}
	require.NoError(t, Validate(cfg))
}

func TestValidate_Nil(t *testing.T) {
	require.NoError(t, Validate(nil))
}

func TestValidate_Empty(t *testing.T) {
	require.NoError(t, Validate(&config.GRPCProtocolConfig{}))
}

func TestValidate_InvalidDefault(t *testing.T) {
	err := Validate(&config.GRPCProtocolConfig{Default: "invalid"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "grpc_protocol.default")
}

func TestValidate_InvalidEncoding(t *testing.T) {
	err := Validate(&config.GRPCProtocolConfig{DefaultEncoding: "xml"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "grpc_protocol.default_encoding")
}

func TestValidate_InvalidSubgraphProtocol(t *testing.T) {
	err := Validate(&config.GRPCProtocolConfig{
		Subgraphs: map[string]config.SubgraphGRPCProtocolConfig{
			"rpc-a": {Protocol: "http2"},
		},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "grpc_protocol.subgraphs.rpc-a.protocol")
}
