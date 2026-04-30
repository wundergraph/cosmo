package grpcprotocol

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/config"
	grpcdatasource "github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/grpc_datasource"
)

// BuildConnectTransports creates a map of subgraphName → RPCTransport
// for all subgraphs configured to use ConnectRPC.
// Returns nil if no subgraphs are configured for Connect.
func BuildConnectTransports(
	cfg *config.GRPCProtocolConfiguration,
	grpcSubgraphURLs map[string]string,
	subgraphHTTPClients map[string]*http.Client,
	defaultHTTPClient *http.Client,
) map[string]grpcdatasource.RPCTransport {
	if cfg == nil {
		return nil
	}

	transports := make(map[string]grpcdatasource.RPCTransport)

	for subgraphName, routingURL := range grpcSubgraphURLs {
		if ResolveProtocol(cfg, subgraphName) != ProtocolConnectRPC {
			continue
		}

		httpClient := defaultHTTPClient
		if sgClient, ok := subgraphHTTPClients[subgraphName]; ok {
			httpClient = sgClient
		}

		var connectEncoding grpcdatasource.ConnectEncoding
		if ResolveEncoding(cfg, subgraphName) == EncodingJSON {
			connectEncoding = grpcdatasource.ConnectEncodingJSON
		} else {
			connectEncoding = grpcdatasource.ConnectEncodingProtobuf
		}

		transports[subgraphName] = grpcdatasource.NewConnectTransport(
			grpcdatasource.ConnectTransportConfig{
				BaseURL:    routingURL,
				HTTPClient: httpClient,
				Encoding:   connectEncoding,
			},
		)
	}

	if len(transports) == 0 {
		return nil
	}
	return transports
}
