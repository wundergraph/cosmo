package testenv

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// CaptureSubgraphMetadataInterceptor returns a UnaryClientInterceptor that
// records the outgoing gRPC metadata of subgraph RPCs (methods under
// /service.*). Lifecycle RPCs (/plugin.*) issued by hashicorp/go-plugin are
// ignored to keep the capture aligned with the test request and to avoid a
// data race between the GraphQL call and the plugin's shutdown RPC.
func CaptureSubgraphMetadataInterceptor(captured *metadata.MD) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if strings.HasPrefix(method, "/service.") {
			md, _ := metadata.FromOutgoingContext(ctx)
			*captured = md.Copy()
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// GRPCPluginHeaderCase is a single header-forwarding scenario shared
// across the standard and OCI gRPC-plugin test suites.
type GRPCPluginHeaderCase struct {
	Name           string
	HeaderRules    config.HeaderRules
	RequestHeaders http.Header
	Assert         func(t *testing.T, captured metadata.MD)
}

func propagateNamed(names ...string) config.HeaderRules {
	rules := make([]*config.RequestHeaderRule, 0, len(names))
	for _, n := range names {
		rules = append(rules, &config.RequestHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Named:     n,
		})
	}
	return config.HeaderRules{All: &config.GlobalHeaderRule{Request: rules}}
}

func propagateMatching(pattern string) config.HeaderRules {
	return config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: config.HeaderRuleOperationPropagate, Matching: pattern},
			},
		},
	}
}

// GRPCPluginHeaderCases returns the header-forwarding matrix that must
// hold for any gRPC-plugin loading strategy (filesystem path or OCI
// registry pull).
func GRPCPluginHeaderCases() []GRPCPluginHeaderCase {
	return []GRPCPluginHeaderCase{
		{
			Name:        "header arrives as metadata with correct value",
			HeaderRules: propagateNamed("X-Tenant-Id", "X-Region-Name"),
			RequestHeaders: http.Header{
				"X-Tenant-Id":   []string{"acme"},
				"X-Region-Name": []string{"frankfurt"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				require.Equal(t, []string{"acme"}, captured.Get("x-tenant-id"))
				require.Equal(t, []string{"frankfurt"}, captured.Get("x-region-name"))
			},
		},
		{
			Name:        "header not in propagation rules is absent from metadata",
			HeaderRules: propagateNamed("X-Allowed"),
			RequestHeaders: http.Header{
				"X-Allowed":     []string{"yes"},
				"X-Not-Allowed": []string{"secret"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				require.Equal(t, []string{"yes"}, captured.Get("x-allowed"))
				require.Empty(t, captured.Get("x-not-allowed"))
			},
		},
		{
			Name:        "header with multiple values arrives as multiple metadata values",
			HeaderRules: propagateNamed("X-Role"),
			RequestHeaders: http.Header{
				"X-Role": []string{"admin", "editor"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				require.Equal(t, []string{"admin", "editor"}, captured.Get("x-role"))
			},
		},
		{
			// The router avoids passing certain headers to datasources,
			// see router/core/header_rule_engine.go. This case ensures
			// gRPC datasources are covered by the same filtering.
			Name:        "unsafe headers are absent from metadata",
			HeaderRules: propagateMatching(".*"),
			RequestHeaders: http.Header{
				"X-Custom": []string{"value"},

				// handled by HTTP stack, never in r.Header
				"Host": []string{"evil.example.com"},

				// hop-by-hop / connection headers
				"Alt-Svc":             []string{"h3=\":443\""},
				"Connection":          []string{"keep-alive"},
				"Keep-Alive":          []string{"timeout=5"},
				"Proxy-Authenticate":  []string{"Basic"},
				"Proxy-Authorization": []string{"Basic dXNlcjpwYXNz"},
				"Proxy-Connection":    []string{"keep-alive"},
				"Te":                  []string{"trailers"},
				"Trailer":             []string{"Expires"},
				"Transfer-Encoding":   []string{"chunked"},
				"Upgrade":             []string{"websocket"},

				// content negotiation
				"Accept":           []string{"application/json"},
				"Accept-Charset":   []string{"utf-8"},
				"Accept-Encoding":  []string{"gzip, deflate"},
				"Content-Encoding": []string{"gzip"},
				"Content-Length":   []string{"42"},
				"Content-Type":     []string{"application/json"},

				// WebSocket upgrade
				"Sec-Websocket-Extensions": []string{"permessage-deflate"},
				"Sec-Websocket-Key":        []string{"dGhlIHNhbXBsZSBub25jZQ=="},
				"Sec-Websocket-Protocol":   []string{"chat"},
				"Sec-Websocket-Version":    []string{"13"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				// We only assert what the router writes to outgoing metadata
				// before the gRPC transport runs. content-type, user-agent
				// and HTTP/2 pseudo-headers (:authority, :method, :path,
				// :scheme) are added later by the transport when framing
				// HTTP/2 and are not visible to a client interceptor;
				// verifying them would require a server interceptor inside
				// the plugin binary.
				require.Equal(t, []string{"value"}, captured.Get("x-custom"))
				for _, h := range []string{
					"host",
					"alt-svc", "connection", "keep-alive",
					"proxy-authenticate", "proxy-authorization", "proxy-connection",
					"te", "trailer", "transfer-encoding", "upgrade",
					"accept", "accept-charset", "accept-encoding",
					"content-encoding", "content-length",
					"sec-websocket-extensions", "sec-websocket-key",
					"sec-websocket-protocol", "sec-websocket-version",
				} {
					require.Empty(t, captured.Get(h), "expected %q to be stripped from outgoing metadata", h)
				}
			},
		},
		{
			// Headers prefixed with "grpc-" are reserved by the gRPC
			// protocol spec. Even with wildcard propagation, they must
			// never appear on the subgraph.
			Name:        "grpc-reserved headers never reach the subgraph",
			HeaderRules: propagateMatching(".*"),
			RequestHeaders: http.Header{
				"Grpc-ReservedHeader": []string{"should be ignored"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				require.Empty(t, captured.Get("grpc-reservedheader"))
			},
		},
		{
			Name:        "safe headers are present in metadata",
			HeaderRules: propagateNamed("Authorization", "Cookie", "Traceparent", "Tracestate", "Accept-Language"),
			RequestHeaders: http.Header{
				"Authorization":   []string{"Bearer eyJhbGciOiJSUzI1NiJ9"},
				"Cookie":          []string{"session=abc123; theme=dark"},
				"Traceparent":     []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
				"Tracestate":      []string{"rojo=00f067aa0ba902b7"},
				"Accept-Language": []string{"de-DE,de;q=0.9,en;q=0.8"},
			},
			Assert: func(t *testing.T, captured metadata.MD) {
				require.Equal(t, []string{"Bearer eyJhbGciOiJSUzI1NiJ9"}, captured.Get("authorization"))
				require.Equal(t, []string{"session=abc123; theme=dark"}, captured.Get("cookie"))
				require.Equal(t, []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}, captured.Get("traceparent"))
				require.Equal(t, []string{"rojo=00f067aa0ba902b7"}, captured.Get("tracestate"))
				require.Equal(t, []string{"de-DE,de;q=0.9,en;q=0.8"}, captured.Get("accept-language"))
			},
		},
	}
}

// RunGRPCPluginHeaderCases drives the gRPC-plugin header forwarding
// matrix against the supplied base testenv config. The caller fills in
// plugin-loading specifics (filesystem path vs OCI registry) and this
// helper layers the capture interceptor, header rules, and request on top.
func RunGRPCPluginHeaderCases(t *testing.T, base Config) {
	t.Helper()
	for _, tc := range GRPCPluginHeaderCases() {
		t.Run(tc.Name, func(t *testing.T) {
			t.Parallel()

			var captured metadata.MD

			cfg := base
			cfg.RouterOptions = append([]core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(CaptureSubgraphMetadataInterceptor(&captured))),
				core.WithHeaderRules(tc.HeaderRules),
			}, base.RouterOptions...)

			Run(t, &cfg, func(t *testing.T, xEnv *Environment) {
				xEnv.MakeGraphQLRequestOK(GraphQLRequest{
					Query:  `query { projects { id name } }`,
					Header: tc.RequestHeaders,
				})
				tc.Assert(t, captured)
			})
		})
	}
}
