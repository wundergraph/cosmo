package integration

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestOCIPlugin_PullAndRun(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)

	projectsBinary := fmt.Sprintf("../router/plugins/projects/bin/%s_%s", runtime.GOOS, runtime.GOARCH)
	coursesBinary := fmt.Sprintf("../router/plugins/courses/bin/%s_%s", runtime.GOOS, runtime.GOARCH)

	buildAndPushPluginImage(t, registryHost, "test-org/projects", "v1", projectsBinary)
	buildAndPushPluginImage(t, registryHost, "test-org/courses", "v1", coursesBinary)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { projects { id name } }`,
		})
		require.Equal(t, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)

		response = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { courses { id title description } }`,
		})
		require.Equal(t, `{"data":{"courses":[{"id":"1","title":"Introduction to TypeScript","description":"Learn the basics of TypeScript"},{"id":"2","title":"Advanced GraphQL","description":"Master GraphQL federation"},{"id":"3","title":"Go Programming","description":"Build services with Go"}]}}`, response.Body)
	})
}

func TestOCIPlugin_ImageNotFound(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)
	// Don't push any images — registry is empty

	testenv.FailsOnStartup(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, err error) {
		require.ErrorContains(t, err, "pulling image")
	})
}

func TestOCIPlugin_Restart(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)

	projectsBinary := fmt.Sprintf("../router/plugins/projects/bin/%s_%s", runtime.GOOS, runtime.GOARCH)
	coursesBinary := fmt.Sprintf("../router/plugins/courses/bin/%s_%s", runtime.GOOS, runtime.GOARCH)

	buildAndPushPluginImage(t, registryHost, "test-org/projects", "v1", projectsBinary)
	buildAndPushPluginImage(t, registryHost, "test-org/courses", "v1", coursesBinary)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
		ModifyRouterConfig:       addOCIImageReferences,
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.ErrorLevel,
		},
		Plugins: testenv.PluginConfig{
			Enabled:     true,
			RegistryURL: registryHost,
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { killService }`,
		})

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			logMessages := xEnv.Observer().All()
			require.True(c, slices.ContainsFunc(logMessages, func(msg observer.LoggedEntry) bool {
				return strings.Contains(msg.Message, "plugin process exited")
			}), "expected to find 'plugin process exited' message in logs")
		}, 5*time.Second, 1*time.Second)

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			response, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
			})
			require.NoError(c, err)
			require.Equal(c, 200, response.Response.StatusCode)
			require.Equal(c, `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`, response.Body)
		}, 20*time.Second, 2*time.Second)
	})
}

func TestOCIPluginWithHeaderForwarding(t *testing.T) {
	t.Parallel()

	registryHost := startTestOCIRegistry(t)

	projectsBinary := fmt.Sprintf("../router/plugins/projects/bin/%s_%s", runtime.GOOS, runtime.GOARCH)
	coursesBinary := fmt.Sprintf("../router/plugins/courses/bin/%s_%s", runtime.GOOS, runtime.GOARCH)

	buildAndPushPluginImage(t, registryHost, "test-org/projects", "v1", projectsBinary)
	buildAndPushPluginImage(t, registryHost, "test-org/courses", "v1", coursesBinary)

	// captureInterceptor records the outgoing metadata of subgraph RPCs only.
	// hashicorp/go-plugin issues lifecycle RPCs under /plugin.*; ignoring them
	// keeps the capture aligned with the test request and avoids a data race
	// between the GraphQL call and the plugin's shutdown RPC.
	captureInterceptor := func(captured *metadata.MD) grpc.UnaryClientInterceptor {
		return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
			if strings.HasPrefix(method, "/service.") {
				md, _ := metadata.FromOutgoingContext(ctx)
				*captured = md.Copy()
			}
			return invoker(ctx, method, req, reply, cc, opts...)
		}
	}

	t.Run("header arrives as metadata with correct value", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Named: "X-Tenant-Id"},
							{Operation: config.HeaderRuleOperationPropagate, Named: "X-Region-Name"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"X-Tenant-Id":   []string{"acme"},
					"X-Region-Name": []string{"frankfurt"},
				},
			})

			require.Equal(t, []string{"acme"}, captured.Get("x-tenant-id"))
			require.Equal(t, []string{"frankfurt"}, captured.Get("x-region-name"))
		})
	})

	t.Run("header not in propagation rules is absent from metadata", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Named: "X-Allowed"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"X-Allowed":     []string{"yes"},
					"X-Not-Allowed": []string{"secret"},
				},
			})

			require.Equal(t, []string{"yes"}, captured.Get("x-allowed"))
			require.Empty(t, captured.Get("x-not-allowed"))
		})
	})

	t.Run("header with multiple values arrives as multiple metadata values", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Named: "X-Role"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"X-Role": []string{"admin", "editor"},
				},
			})

			require.Equal(t, []string{"admin", "editor"}, captured.Get("x-role"))
		})
	})

	t.Run("unsafe headers are absent from metadata", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Matching: ".*"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"X-Custom": []string{"value"},

					"Host": []string{"evil.example.com"},

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

					"Accept":           []string{"application/json"},
					"Accept-Charset":   []string{"utf-8"},
					"Accept-Encoding":  []string{"gzip, deflate"},
					"Content-Encoding": []string{"gzip"},
					"Content-Length":   []string{"42"},
					"Content-Type":     []string{"application/json"},

					"Sec-Websocket-Extensions": []string{"permessage-deflate"},
					"Sec-Websocket-Key":        []string{"dGhlIHNhbXBsZSBub25jZQ=="},
					"Sec-Websocket-Protocol":   []string{"chat"},
					"Sec-Websocket-Version":    []string{"13"},
				},
			})

			// We only assert what the router writes to outgoing metadata before
			// the gRPC transport runs. content-type, user-agent and HTTP/2
			// pseudo-headers (:authority, :method, :path, :scheme) are added
			// later by the transport when framing HTTP/2 and are not visible
			// to a client interceptor; verifying them would require a server
			// interceptor inside the plugin binary.

			require.Equal(t, []string{"value"}, captured.Get("x-custom"))

			require.Empty(t, captured.Get("host"))

			require.Empty(t, captured.Get("alt-svc"))
			require.Empty(t, captured.Get("connection"))
			require.Empty(t, captured.Get("keep-alive"))
			require.Empty(t, captured.Get("proxy-authenticate"))
			require.Empty(t, captured.Get("proxy-authorization"))
			require.Empty(t, captured.Get("proxy-connection"))
			require.Empty(t, captured.Get("te"))
			require.Empty(t, captured.Get("trailer"))
			require.Empty(t, captured.Get("transfer-encoding"))
			require.Empty(t, captured.Get("upgrade"))

			require.Empty(t, captured.Get("accept"))
			require.Empty(t, captured.Get("accept-charset"))
			require.Empty(t, captured.Get("accept-encoding"))
			require.Empty(t, captured.Get("content-encoding"))
			require.Empty(t, captured.Get("content-length"))

			require.Empty(t, captured.Get("sec-websocket-extensions"))
			require.Empty(t, captured.Get("sec-websocket-key"))
			require.Empty(t, captured.Get("sec-websocket-protocol"))
			require.Empty(t, captured.Get("sec-websocket-version"))
		})
	})

	t.Run("grpc-reserved headers never reach the subgraph", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Matching: ".*"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"Grpc-ReservedHeader": []string{"should be ignored"},
				},
			})

			require.Empty(t, captured.Get("grpc-reservedheader"))
		})
	})

	t.Run("safe headers are present in metadata", func(t *testing.T) {
		t.Parallel()

		var captured metadata.MD

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithPluginsJSONTemplate,
			ModifyRouterConfig:       addOCIImageReferences,
			Plugins: testenv.PluginConfig{
				Enabled:     true,
				RegistryURL: registryHost,
			},
			RouterOptions: []core.Option{
				core.WithGRPCPluginDialOptions(grpc.WithUnaryInterceptor(captureInterceptor(&captured))),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"},
							{Operation: config.HeaderRuleOperationPropagate, Named: "Cookie"},
							{Operation: config.HeaderRuleOperationPropagate, Named: "Traceparent"},
							{Operation: config.HeaderRuleOperationPropagate, Named: "Tracestate"},
							{Operation: config.HeaderRuleOperationPropagate, Named: "Accept-Language"},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { projects { id name } }`,
				Header: http.Header{
					"Authorization":   []string{"Bearer eyJhbGciOiJSUzI1NiJ9"},
					"Cookie":          []string{"session=abc123; theme=dark"},
					"Traceparent":     []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
					"Tracestate":      []string{"rojo=00f067aa0ba902b7"},
					"Accept-Language": []string{"de-DE,de;q=0.9,en;q=0.8"},
				},
			})

			require.Equal(t, []string{"Bearer eyJhbGciOiJSUzI1NiJ9"}, captured.Get("authorization"))
			require.Equal(t, []string{"session=abc123; theme=dark"}, captured.Get("cookie"))
			require.Equal(t, []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}, captured.Get("traceparent"))
			require.Equal(t, []string{"rojo=00f067aa0ba902b7"}, captured.Get("tracestate"))
			require.Equal(t, []string{"de-DE,de;q=0.9,en;q=0.8"}, captured.Get("accept-language"))
		})
	})
}

// addOCIImageReferences adds imageReference fields to plugin datasources,
// deriving the OCI config from the base plugins config at runtime.
func addOCIImageReferences(routerConfig *nodev1.RouterConfig) {
	for _, ds := range routerConfig.EngineConfig.DatasourceConfigurations {
		plugin := ds.GetCustomGraphql().GetGrpc().GetPlugin()
		if plugin == nil {
			continue
		}
		switch plugin.Name {
		case "projects":
			plugin.ImageReference = &nodev1.ImageReference{
				Repository: "test-org/projects",
				Reference:  "v1",
			}
		case "courses":
			plugin.ImageReference = &nodev1.ImageReference{
				Repository: "test-org/courses",
				Reference:  "v1",
			}
		}
	}
}
