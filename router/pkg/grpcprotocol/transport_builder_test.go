package grpcprotocol

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestBuildConnectTransports_NilConfig(t *testing.T) {
	result := BuildConnectTransports(nil, map[string]string{"rpc": "http://localhost"}, nil, http.DefaultClient)
	assert.Nil(t, result)
}

func TestBuildConnectTransports_AllGRPC(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{Default: ProtocolGRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	result := BuildConnectTransports(cfg, urls, nil, http.DefaultClient)
	assert.Nil(t, result)
}

func TestBuildConnectTransports_ConnectSubgraph(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{Default: ProtocolConnectRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	result := BuildConnectTransports(cfg, urls, nil, http.DefaultClient)
	assert.NotNil(t, result)
	assert.Contains(t, result, "rpc-a")
}

func TestBuildConnectTransports_MixedProtocols(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{
		Default: ProtocolGRPC,
		Subgraphs: map[string]config.SubgraphGRPCProtocolConfig{
			"rpc-connect": {Protocol: ProtocolConnectRPC},
		},
	}
	urls := map[string]string{
		"rpc-grpc":    "http://localhost:3001",
		"rpc-connect": "http://localhost:3002",
	}
	result := BuildConnectTransports(cfg, urls, nil, http.DefaultClient)
	assert.NotNil(t, result)
	assert.Contains(t, result, "rpc-connect")
	assert.NotContains(t, result, "rpc-grpc")
}

func TestBuildConnectTransports_UsesPerSubgraphHTTPClient(t *testing.T) {
	customClient := &http.Client{}
	cfg := &config.GRPCProtocolConfig{Default: ProtocolConnectRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	sgClients := map[string]*http.Client{"rpc-a": customClient}

	result := BuildConnectTransports(cfg, urls, sgClients, http.DefaultClient)
	assert.NotNil(t, result)
	assert.Contains(t, result, "rpc-a")
}

func TestBuildConnectTransports_EmptyURLs(t *testing.T) {
	cfg := &config.GRPCProtocolConfig{Default: ProtocolConnectRPC}
	result := BuildConnectTransports(cfg, map[string]string{}, nil, http.DefaultClient)
	assert.Nil(t, result)
}
