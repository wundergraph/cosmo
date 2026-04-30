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
	cfg := &config.GRPCProtocolConfiguration{DefaultProtocol: ProtocolGRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	result := BuildConnectTransports(cfg, urls, nil, http.DefaultClient)
	assert.Nil(t, result)
}

func TestBuildConnectTransports_ConnectSubgraph(t *testing.T) {
	cfg := &config.GRPCProtocolConfiguration{DefaultProtocol: ProtocolConnectRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	result := BuildConnectTransports(cfg, urls, nil, http.DefaultClient)
	assert.NotNil(t, result)
	assert.Contains(t, result, "rpc-a")
}

func TestBuildConnectTransports_MixedProtocols(t *testing.T) {
	cfg := &config.GRPCProtocolConfiguration{
		DefaultProtocol: ProtocolGRPC,
		Subgraphs: map[string]config.GRPCProtocolSubgraph{
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
	cfg := &config.GRPCProtocolConfiguration{DefaultProtocol: ProtocolConnectRPC}
	urls := map[string]string{"rpc-a": "http://localhost:3000"}
	sgClients := map[string]*http.Client{"rpc-a": customClient}

	result := BuildConnectTransports(cfg, urls, sgClients, http.DefaultClient)
	assert.NotNil(t, result)
	assert.Contains(t, result, "rpc-a")
}

func TestBuildConnectTransports_EmptyURLs(t *testing.T) {
	cfg := &config.GRPCProtocolConfiguration{DefaultProtocol: ProtocolConnectRPC}
	result := BuildConnectTransports(cfg, map[string]string{}, nil, http.DefaultClient)
	assert.Nil(t, result)
}

func TestNormalizeConnectBaseURL(t *testing.T) {
	// The federated graph stores routing URLs in whichever scheme the user
	// registered them with: gRPC name resolver schemes (dns:///, ipv4://...),
	// the bare host:port form, or http(s):// for ConnectRPC. The Connect
	// HTTP client only understands http(s)://, so this test pins down the
	// translation between the two worlds.
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty input passes through", in: "", want: ""},
		{name: "http URL pass-through", in: "http://localhost:8080", want: "http://localhost:8080"},
		{name: "https URL pass-through", in: "https://api.example.com:8443/v1", want: "https://api.example.com:8443/v1"},
		{name: "dns scheme triple slash", in: "dns:///localhost:8080", want: "http://localhost:8080"},
		{name: "dns scheme with authority host:port", in: "dns://8.8.8.8/example.com:9000", want: "http://example.com:9000"},
		{name: "dns scheme single colon (no slashes)", in: "dns:localhost:8080", want: "http://localhost:8080"},
		{name: "plain host:port (defaults to dns)", in: "localhost:8080", want: "http://localhost:8080"},
		{name: "ipv4 scheme single endpoint", in: "ipv4:127.0.0.1:8080", want: "http://127.0.0.1:8080"},
		{name: "unix scheme triple slash", in: "unix:///tmp/grpc.sock", want: "http://tmp/grpc.sock"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeConnectBaseURL(tt.in)
			assert.Equal(t, tt.want, got)
		})
	}
}
