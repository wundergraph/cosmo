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
// graph - which may use the gRPC name resolver conventions like
// "dns:///host:port" or "dns:host:port", or a bare host:port - into the
// http URL that the ConnectRPC HTTP client expects. URLs that already use
// http or https are returned as-is.
//
// The set of supported source schemes mirrors isValidGrpcNamingScheme on
// the control plane (dns, ipv4, ipv6, vsock, unix, unix-abstract,
// passthrough). For schemes that wrap an authority component
// (`scheme://authority/endpoint`) the authority is dropped because Connect
// targets the endpoint directly.
func normalizeConnectBaseURL(routingURL string) string {
	if routingURL == "" {
		return routingURL
	}
	if strings.HasPrefix(routingURL, "http://") || strings.HasPrefix(routingURL, "https://") {
		return routingURL
	}

	// Order matters: longer prefixes must be checked before their shorter
	// substrings (`unix-abstract:` before `unix:`).
	grpcSchemes := []string{"unix-abstract:", "passthrough:", "dns:", "ipv4:", "ipv6:", "vsock:", "unix:"}
	for _, prefix := range grpcSchemes {
		if !strings.HasPrefix(routingURL, prefix) {
			continue
		}
		rest := routingURL[len(prefix):]
		// `scheme://authority/endpoint` and `scheme:///endpoint` both end up
		// with a leading `//`; strip the authority and the path separator so
		// only the endpoint survives.
		if strings.HasPrefix(rest, "//") {
			after := rest[2:]
			if i := strings.Index(after, "/"); i >= 0 {
				rest = after[i+1:]
			} else {
				rest = after
			}
		}
		return "http://" + rest
	}
	return "http://" + routingURL
}
