package grpcprotocol

import (
	"net/http"
	"strings"

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
				BaseURL:    normalizeConnectBaseURL(routingURL),
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

// normalizeConnectBaseURL converts a routing URL declared in the federated
// graph (which may use the gRPC scheme conventions like "dns:///host:port"
// or be a bare host:port) into the http(s) URL that the ConnectRPC HTTP
// client expects. URLs that already use http or https are returned as-is.
func normalizeConnectBaseURL(routingURL string) string {
	if routingURL == "" {
		return routingURL
	}
	if strings.HasPrefix(routingURL, "http://") || strings.HasPrefix(routingURL, "https://") {
		return routingURL
	}
	// gRPC name resolver prefixes (dns:///, passthrough:///, unix:) are not
	// understood by net/http; strip the scheme so the host:port can be
	// re-prefixed with http://.
	if idx := strings.Index(routingURL, "://"); idx > 0 {
		routingURL = strings.TrimLeft(routingURL[idx+3:], "/")
	}
	return "http://" + routingURL
}
