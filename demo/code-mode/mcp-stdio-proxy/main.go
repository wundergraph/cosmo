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
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	// 127.0.0.1 (not localhost) so the Go HTTP client doesn't try ::1 first
	// and get refused — the router binds IPv4 only.
	defaultUpstreamURL = "http://127.0.0.1:5027/mcp"
	proxyName          = "yoko-stdio-proxy"
	proxyVersion       = "0.1.0"

	initialReconnectBackoff = 500 * time.Millisecond
	maxReconnectBackoff     = 30 * time.Second
	upstreamKeepAlive       = 30 * time.Second
)

type proxyOptions struct {
	upstreamURL string
	transport   mcp.Transport
	httpClient  *http.Client
	// keepAlive overrides the upstream client KeepAlive interval. Zero uses the
	// default. Tests use a short interval so disconnects are detected quickly.
	keepAlive time.Duration
	// initialBackoff overrides the initial reconnect backoff. Zero uses the
	// default. Tests use a short value to keep reconnect latency low.
	initialBackoff time.Duration
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
	keepAlive := opts.keepAlive
	if keepAlive == 0 {
		keepAlive = upstreamKeepAlive
	}
	initialBackoff := opts.initialBackoff
	if initialBackoff == 0 {
		initialBackoff = initialReconnectBackoff
	}

	var localSession atomic.Pointer[mcp.ServerSession]
	upstreamClient := mcp.NewClient(
		&mcp.Implementation{Name: proxyName, Version: proxyVersion},
		&mcp.ClientOptions{
			KeepAlive: keepAlive,
			ElicitationHandler: func(ctx context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
				ss := localSession.Load()
				if ss == nil {
					return nil, errors.New("no local session yet")
				}
				return ss.Elicit(ctx, req.Params)
			},
		},
	)

	upstream := &upstreamConn{
		client:         upstreamClient,
		upstreamURL:    opts.upstreamURL,
		httpClient:     opts.httpClient,
		initialBackoff: initialBackoff,
		ready:          make(chan struct{}),
	}

	initialSession, err := upstream.connectWithRetry(ctx, "upstream connect")
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return fmt.Errorf("connect upstream %q failed: %w; is the demo running? try `make code-mode-demo`", opts.upstreamURL, err)
	}
	upstream.setSession(initialSession)

	defer func() {
		if s := upstream.currentSession(); s != nil {
			if err := s.Close(); err != nil {
				log.Printf("mcp-stdio-proxy: upstream close failed: %v", err)
			}
		}
	}()

	toolsResp, err := initialSession.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		return fmt.Errorf("list upstream tools: %w", err)
	}
	resourcesResp, err := initialSession.ListResources(ctx, &mcp.ListResourcesParams{})
	if err != nil {
		return fmt.Errorf("list upstream resources: %w", err)
	}

	supervisorCtx, cancelSupervisor := context.WithCancel(ctx)
	defer cancelSupervisor()
	supervisorDone := make(chan struct{})
	go func() {
		defer close(supervisorDone)
		upstream.supervise(supervisorCtx, initialSession)
	}()
	defer func() {
		cancelSupervisor()
		<-supervisorDone
	}()

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
			session, err := upstream.awaitSession(ctx)
			if err != nil {
				var errResult mcp.CallToolResult
				errResult.SetError(fmt.Errorf("upstream tool %q unavailable: %w", req.Params.Name, err))
				return &errResult, nil
			}
			result, err := session.CallTool(ctx, &mcp.CallToolParams{
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
			session, err := upstream.awaitSession(ctx)
			if err != nil {
				return nil, fmt.Errorf("upstream resource %q unavailable: %w", req.Params.URI, err)
			}
			result, err := session.ReadResource(ctx, req.Params)
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

// upstreamConn keeps a live MCP client session to the upstream router, dialing
// initially with backoff and reconnecting transparently when the session drops.
type upstreamConn struct {
	client         *mcp.Client
	upstreamURL    string
	httpClient     *http.Client
	initialBackoff time.Duration

	mu      sync.Mutex
	session *mcp.ClientSession
	ready   chan struct{}
}

func (u *upstreamConn) dial(ctx context.Context) (*mcp.ClientSession, error) {
	return u.client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   u.upstreamURL,
		HTTPClient: u.httpClient,
	}, nil)
}

// connectWithRetry dials the upstream, retrying with exponential backoff until
// the context is cancelled.
func (u *upstreamConn) connectWithRetry(ctx context.Context, label string) (*mcp.ClientSession, error) {
	backoff := u.initialBackoff
	if backoff == 0 {
		backoff = initialReconnectBackoff
	}
	for attempt := 1; ; attempt++ {
		s, err := u.dial(ctx)
		if err == nil {
			if attempt > 1 {
				log.Printf("mcp-stdio-proxy: %s succeeded on attempt %d", label, attempt)
			}
			return s, nil
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		log.Printf("mcp-stdio-proxy: %s attempt %d failed: %v; retrying in %s", label, attempt, err, backoff)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < maxReconnectBackoff {
			backoff *= 2
			if backoff > maxReconnectBackoff {
				backoff = maxReconnectBackoff
			}
		}
	}
}

// supervise watches the active upstream session and reconnects when it drops.
// Returns when ctx is cancelled.
func (u *upstreamConn) supervise(ctx context.Context, initial *mcp.ClientSession) {
	cur := initial
	for {
		waitDone := make(chan struct{})
		go func(s *mcp.ClientSession) {
			_ = s.Wait()
			close(waitDone)
		}(cur)

		select {
		case <-ctx.Done():
			return
		case <-waitDone:
		}
		if ctx.Err() != nil {
			return
		}

		log.Printf("mcp-stdio-proxy: upstream session closed; reconnecting...")
		u.markUnready()

		next, err := u.connectWithRetry(ctx, "upstream reconnect")
		if err != nil {
			return
		}
		u.setSession(next)
		log.Printf("mcp-stdio-proxy: upstream reconnected")
		cur = next
	}
}

// awaitSession returns the current upstream session, blocking until one is
// available or ctx is cancelled.
func (u *upstreamConn) awaitSession(ctx context.Context) (*mcp.ClientSession, error) {
	for {
		u.mu.Lock()
		if u.session != nil {
			s := u.session
			u.mu.Unlock()
			return s, nil
		}
		ready := u.ready
		u.mu.Unlock()
		select {
		case <-ready:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// currentSession returns the current session without blocking. Used at shutdown
// to close whatever session is live.
func (u *upstreamConn) currentSession() *mcp.ClientSession {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.session
}

func (u *upstreamConn) setSession(s *mcp.ClientSession) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.session = s
	if u.ready != nil {
		close(u.ready)
		u.ready = nil
	}
}

func (u *upstreamConn) markUnready() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.session = nil
	if u.ready == nil {
		u.ready = make(chan struct{})
	}
}
