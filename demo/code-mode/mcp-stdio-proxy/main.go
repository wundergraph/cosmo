package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	// 127.0.0.1 (not localhost) so the Go HTTP client doesn't try ::1 first
	// and get refused — the router binds IPv4 only.
	defaultUpstreamURL = "http://127.0.0.1:5027/mcp"
	proxyName          = "yoko-stdio-proxy"
	proxyVersion       = "0.1.0"
)

type proxyOptions struct {
	upstreamURL string
	transport   mcp.Transport
	httpClient  *http.Client
}

func main() {
	log.SetOutput(os.Stderr)

	flags := flag.NewFlagSet(os.Args[0], flag.ExitOnError)
	flags.SetOutput(os.Stderr)
	upstreamURL := flags.String("upstream", defaultUpstreamURL, "HTTP MCP upstream URL")
	flags.Usage = func() {
		fmt.Fprintf(flags.Output(), "Usage: mcp-stdio-proxy --upstream <URL>\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(os.Args[1:]); err != nil {
		os.Exit(2)
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "mcp-stdio-proxy: unexpected positional arguments")
		flags.Usage()
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := runProxy(ctx, proxyOptions{
		upstreamURL: *upstreamURL,
		transport:   &mcp.StdioTransport{},
	}); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("mcp-stdio-proxy: %v", err)
	}
}

func runProxy(ctx context.Context, opts proxyOptions) error {
	if opts.upstreamURL == "" {
		opts.upstreamURL = defaultUpstreamURL
	}
	if opts.transport == nil {
		opts.transport = &mcp.StdioTransport{}
	}

	var localSession atomic.Pointer[mcp.ServerSession]
	upstreamClient := mcp.NewClient(
		&mcp.Implementation{Name: proxyName, Version: proxyVersion},
		&mcp.ClientOptions{
			ElicitationHandler: func(ctx context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
				ss := localSession.Load()
				if ss == nil {
					return nil, errors.New("no local session yet")
				}
				return ss.Elicit(ctx, req.Params)
			},
		},
	)

	upstreamSession, err := upstreamClient.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   opts.upstreamURL,
		HTTPClient: opts.httpClient,
	}, nil)
	if err != nil {
		return fmt.Errorf("connect upstream %q failed: %w; is the demo running? try `make code-mode-demo`", opts.upstreamURL, err)
	}
	defer func() {
		if err := upstreamSession.Close(); err != nil {
			log.Printf("mcp-stdio-proxy: upstream close failed: %v", err)
		}
	}()

	toolsResp, err := upstreamSession.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		return fmt.Errorf("list upstream tools: %w", err)
	}
	resourcesResp, err := upstreamSession.ListResources(ctx, &mcp.ListResourcesParams{})
	if err != nil {
		return fmt.Errorf("list upstream resources: %w", err)
	}

	localServer := mcp.NewServer(
		&mcp.Implementation{Name: "yoko (via stdio-proxy)", Version: proxyVersion},
		&mcp.ServerOptions{
			InitializedHandler: func(_ context.Context, req *mcp.InitializedRequest) {
				localSession.Store(req.Session)
				// Log the downstream client's declared capabilities so we know
				// whether elicitation forwarding will work end to end.
				if p := req.Session.InitializeParams(); p != nil {
					hasElicit := p.Capabilities != nil && p.Capabilities.Elicitation != nil
					name := ""
					ver := ""
					if p.ClientInfo != nil {
						name = p.ClientInfo.Name
						ver = p.ClientInfo.Version
					}
					log.Printf("mcp-stdio-proxy: downstream initialized name=%q version=%q elicitation=%v", name, ver, hasElicit)
				}
			},
		},
	)

	for _, upstreamTool := range toolsResp.Tools {
		tool := *upstreamTool
		if tool.InputSchema == nil {
			tool.InputSchema = map[string]any{"type": "object"}
		}
		localServer.AddTool(&tool, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			result, err := upstreamSession.CallTool(ctx, &mcp.CallToolParams{
				Meta:      req.Params.Meta,
				Name:      req.Params.Name,
				Arguments: req.Params.Arguments,
			})
			if err != nil {
				var errResult mcp.CallToolResult
				errResult.SetError(fmt.Errorf("upstream tool %q failed: %w", req.Params.Name, err))
				return &errResult, nil
			}
			return result, nil
		})
	}

	for _, upstreamResource := range resourcesResp.Resources {
		resource := *upstreamResource
		localServer.AddResource(&resource, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			result, err := upstreamSession.ReadResource(ctx, req.Params)
			if err != nil {
				return nil, fmt.Errorf("upstream resource %q failed: %w", req.Params.URI, err)
			}
			return result, nil
		})
	}

	if err := localServer.Run(ctx, opts.transport); err != nil {
		return err
	}
	return nil
}
