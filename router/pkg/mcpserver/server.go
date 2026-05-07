package mcpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/iancoleman/strcase"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
)

// reservedToolNames contains tool names that are internally registered by the MCP server
// and must not be used by operations when omitToolNamePrefix is enabled.
var reservedToolNames = []string{
	"get_schema",
	"execute_graphql",
	"get_operation_info",
}

// requestHeadersKey is a custom context key for storing request headers.
type requestHeadersKey struct{}

// withRequestHeaders adds request headers to the context.
func withRequestHeaders(ctx context.Context, headers http.Header) context.Context {
	return context.WithValue(ctx, requestHeadersKey{}, headers)
}

// requestHeadersFromRequest extracts all headers from the request and stores them in context.
func requestHeadersFromRequest(ctx context.Context, r *http.Request) context.Context {
	// Clone the headers to avoid any mutation issues
	headers := r.Header.Clone()
	return withRequestHeaders(ctx, headers)
}

// headersFromContext extracts the request headers from the context.
func headersFromContext(ctx context.Context) (http.Header, error) {
	headers, ok := ctx.Value(requestHeadersKey{}).(http.Header)
	if !ok {
		return nil, fmt.Errorf("missing request headers")
	}
	return headers, nil
}

// Options represents configuration options for the GraphQLSchemaServer
type Options struct {
	// GraphName is the name of the graph to be served
	GraphName string
	// OperationsDir is the directory where GraphQL operations are stored
	OperationsDir string
	// ListenAddr is the address where the server should listen to.
	// Only used when this server is started standalone via Serve(); ignored when
	// mounted on a shared listener via RegisterRoutes(mux).
	ListenAddr string
	// Path is the URL path this MCP server is mounted at (e.g. "/mcp", "/internal").
	// Defaults to "/mcp" when empty.
	Path string
	// Enabled determines whether the MCP server should be started
	Enabled bool
	// Logger is the logger to be used
	Logger *zap.Logger
	// RequestTimeout is the timeout for HTTP requests
	RequestTimeout time.Duration
	// ExcludeMutations determines whether mutation operations should be excluded
	ExcludeMutations bool
	// EnableArbitraryOperations determines whether arbitrary GraphQL operations can be executed
	EnableArbitraryOperations bool
	// ExposeSchema determines whether the GraphQL schema is exposed
	ExposeSchema bool
	// OmitToolNamePrefix removes the "execute_operation_" prefix from MCP tool names
	OmitToolNamePrefix bool
	// Stateless determines whether the MCP server should be stateless
	Stateless bool
	// CorsConfig is the CORS configuration for the MCP server
	CorsConfig cors.Config
	// OAuthConfig is the OAuth/JWKS configuration for authentication
	OAuthConfig *config.MCPOAuthConfiguration
	// ServerBaseURL is the base URL of this MCP server (for resource metadata)
	ServerBaseURL string
	// ResourceDocumentation is a URL to a human-readable page describing this resource
	ResourceDocumentation string
	// UpstreamSchemaSDL is the GraphQL schema (as SDL text) for upstream-bound collections
	// that don't share the local supergraph's schema. When set, Reload uses this schema
	// instead of the supergraph schema passed in to Reload().
	UpstreamSchemaSDL string
	// UpstreamHeaders are forwarded to the upstream GraphQL endpoint on every request
	// (in addition to per-request headers).
	UpstreamHeaders map[string]string
	// WatchOperations enables periodic scanning of OperationsDir for added,
	// modified, or removed .graphql / .gql files. When a change is detected,
	// the collection's tools are reloaded without restarting the router.
	WatchOperations bool
	// OperationsWatchInterval is the polling interval used when WatchOperations is true.
	OperationsWatchInterval time.Duration
}

// GraphQLSchemaServer represents an MCP server that works with GraphQL schemas and operations
type GraphQLSchemaServer struct {
	server                    *mcp.Server
	graphName                 string
	operationsDir             string
	listenAddr                string
	path                      string
	logger                    *zap.Logger
	httpClient                *http.Client
	requestTimeout            time.Duration
	routerGraphQLEndpoint     string
	httpServer                *http.Server
	excludeMutations          bool
	enableArbitraryOperations bool
	exposeSchema              bool
	omitToolNamePrefix        bool
	stateless                 bool
	operationsManager         *OperationsManager
	schemaCompiler            *SchemaCompiler
	registeredTools           []string
	corsConfig                cors.Config
	cancel                    context.CancelFunc
	oauthConfig               *config.MCPOAuthConfiguration
	serverBaseURL             string
	resourceDocumentation     string
	authMiddleware            *MCPAuthMiddleware
	upstreamSchemaSDL         string
	upstreamHeaders           map[string]string
	watchOperations           bool
	operationsWatchInterval   time.Duration
	// lastSchema and lastFieldConfigs are remembered so ReloadOperations() can
	// re-run the operations directory load without a fresh schema input.
	lastSchema       *ast.Document
	lastFieldConfigs []*nodev1.FieldConfiguration
	// lastToolFingerprints is the fingerprint of every tool currently registered
	// with s.server. Used by Reload to compute a diff and only emit Remove/Add
	// calls for tools that actually changed — avoiding spurious tools/list_changed
	// notifications when an mtime touch produced no semantic change.
	lastToolFingerprints map[string]string
	// ctx is the per-server context (cancelled on Stop) — used for operation watchers.
	ctx context.Context
	// codeModeSandbox is the V8 isolate used by the code_mode_run_js tool.
	// Lazily initialized on first use; reused across reloads since it only
	// depends on the upstream endpoint, not the op catalog.
	codeModeSandbox *sandbox.Sandbox
}

// desiredTool bundles a Tool spec, its handler, and a content fingerprint so
// the diff-aware reload path can compare against the prior set without
// re-invoking the SDK's AddTool when nothing has changed.
type desiredTool struct {
	tool        *mcp.Tool
	handler     mcp.ToolHandler
	fingerprint string
}

type graphqlRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables"`
}

// ExecuteGraphQLInput defines the input structure for the execute_graphql tool
type ExecuteGraphQLInput struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables,omitempty"`
}

// operationHandler holds an operation and its compiled JSON schema
type operationHandler struct {
	operation      schemaloader.Operation
	compiledSchema *jsonschema.Schema
}

// OperationInfo contains metadata about a GraphQL operation
type OperationInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema,omitempty"`
	Query       string          `json:"query"`
}

// OperationsResponse is the response structure for the listGraphQLOperations tool
type OperationsResponse struct {
	Operations  []OperationInfo `json:"operations"`
	Usage       string          `json:"usage"`
	LLMGuidance LLMGuidance     `json:"llmGuidance"`
	Endpoint    string          `json:"endpoint"`
}

// GraphQLOperationInfoResponse is the response structure for the graphql_operation_info tool.
type GraphQLOperationInfoResponse struct {
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	OperationType  string          `json:"operationType"`
	HasSideEffects bool            `json:"hasSideEffects"`
	Schema         json.RawMessage `json:"schema,omitempty"`
	Query          string          `json:"query"`
	LLMGuidance    LLMGuidance     `json:"llmGuidance"`
	Endpoint       string          `json:"endpoint"`
	RequiredScopes [][]string      `json:"requiredScopes,omitempty"`
}

// GraphQLOperationInfoInput defines the input structure for the graphql_operation_info tool.
type GraphQLOperationInfoInput struct {
	OperationName string `json:"operationName"`
}

// LLMGuidance provides guidance for LLMs on how to use the GraphQL operations
type LLMGuidance struct {
	HTTPUsage      string   `json:"httpUsage"`
	GraphQLRequest string   `json:"graphqlRequest"`
	ExecutionTips  []string `json:"executionTips"`
}

// GraphQLError represents an error returned in a GraphQL response
type GraphQLError struct {
	Message string `json:"message"`
}

// GraphQLResponse represents a GraphQL response structure
type GraphQLResponse struct {
	Errors []GraphQLError  `json:"errors"`
	Data   json.RawMessage `json:"data"`
}

// NewGraphQLSchemaServer creates a new GraphQL schema server
func NewGraphQLSchemaServer(ctx context.Context, routerGraphQLEndpoint string, opts ...func(*Options)) (*GraphQLSchemaServer, error) {
	if routerGraphQLEndpoint == "" {
		return nil, fmt.Errorf("routerGraphQLEndpoint cannot be empty")
	}

	if !strings.Contains(routerGraphQLEndpoint, "://") {
		routerGraphQLEndpoint = "http://" + routerGraphQLEndpoint
	}

	// Default options
	options := &Options{
		GraphName:      "graph",
		OperationsDir:  "operations",
		ListenAddr:     "0.0.0.0:5025",
		Path:           "/mcp",
		Enabled:        false,
		Logger:         zap.NewNop(),
		RequestTimeout: 30 * time.Second,
		ExposeSchema:   true,
		Stateless:      true,
	}

	// Apply all option functions
	for _, opt := range opts {
		opt(options)
	}

	if options.Path == "" {
		options.Path = "/mcp"
	}
	if !strings.HasPrefix(options.Path, "/") {
		return nil, fmt.Errorf("MCP server path must start with '/': got %q", options.Path)
	}

	ctx, cancel := context.WithCancel(ctx)

	var authMiddleware *MCPAuthMiddleware
	if options.OAuthConfig != nil && options.OAuthConfig.Enabled {
		if len(options.OAuthConfig.JWKS) == 0 {
			cancel()
			return nil, fmt.Errorf("MCP OAuth is enabled but no JWKS providers are configured; this would start an unprotected endpoint")
		}
		if options.ServerBaseURL == "" {
			cancel()
			return nil, fmt.Errorf("MCP OAuth is enabled but server base_url is not configured; it is required for OAuth 2.0 Protected Resource Metadata discovery (RFC 9728)")
		}
		// Convert config.JWKSConfiguration to authentication.JWKSConfig
		authConfigs := make([]authentication.JWKSConfig, 0, len(options.OAuthConfig.JWKS))
		for _, jwks := range options.OAuthConfig.JWKS {
			authConfigs = append(authConfigs, authentication.JWKSConfig{
				URL:               jwks.URL,
				RefreshInterval:   jwks.RefreshInterval,
				AllowedAlgorithms: jwks.Algorithms,
				Secret:            jwks.Secret,
				Algorithm:         jwks.Algorithm,
				KeyId:             jwks.KeyId,
				Audiences:         jwks.Audiences,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  jwks.RefreshUnknownKID.Enabled,
					MaxWait:  jwks.RefreshUnknownKID.MaxWait,
					Interval: jwks.RefreshUnknownKID.Interval,
					Burst:    jwks.RefreshUnknownKID.Burst,
				},
			})
		}

		// Create token decoder using the managed context for proper lifecycle management
		tokenDecoder, err := authentication.NewJwksTokenDecoder(
			ctx,
			options.Logger,
			authConfigs,
		)
		if err != nil {
			cancel() // Clean up the context if initialization fails
			return nil, fmt.Errorf("failed to create token decoder: %w", err)
		}

		// Build resource metadata URL for WWW-Authenticate header.
		// Per RFC 9728, each protected resource gets its own metadata endpoint
		// at /.well-known/oauth-protected-resource{path}.
		resourceMetadataURL := ""
		if options.ServerBaseURL != "" {
			resourceMetadataURL = fmt.Sprintf("%s/.well-known/oauth-protected-resource%s", options.ServerBaseURL, options.Path)
		}

		authMiddleware, err = NewMCPAuthMiddleware(tokenDecoder, resourceMetadataURL, options.OAuthConfig.Scopes, options.OAuthConfig.ScopeChallengeIncludeTokenScopes)
		if err != nil {
			cancel() // Clean up the context if initialization fails
			return nil, fmt.Errorf("failed to create auth middleware: %w", err)
		}

		options.Logger.Info("MCP OAuth authentication enabled",
			zap.Int("jwks_providers", len(options.OAuthConfig.JWKS)),
			zap.String("authorization_server", options.OAuthConfig.AuthorizationServerURL))
	}

	// Create the MCP server with all options
	mcpServer := mcp.NewServer(
		&mcp.Implementation{
			Name:    "wundergraph-cosmo-" + strcase.ToKebab(options.GraphName),
			Version: "0.0.1",
		},
		&mcp.ServerOptions{
			PageSize: 100,
			// Override default capabilities to disable the "logging" capability
			// that the SDK advertises by default (for historical reasons).
			// We don't implement logging/setLevel, so advertising it causes
			// clients like MCP Inspector to call it and fail.
			Capabilities: &mcp.ServerCapabilities{},
		},
	)

	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	gs := &GraphQLSchemaServer{
		server:                    mcpServer,
		graphName:                 options.GraphName,
		operationsDir:             options.OperationsDir,
		listenAddr:                options.ListenAddr,
		path:                      options.Path,
		logger:                    options.Logger,
		httpClient:                httpClient,
		requestTimeout:            options.RequestTimeout,
		routerGraphQLEndpoint:     routerGraphQLEndpoint,
		excludeMutations:          options.ExcludeMutations,
		enableArbitraryOperations: options.EnableArbitraryOperations,
		exposeSchema:              options.ExposeSchema,
		omitToolNamePrefix:        options.OmitToolNamePrefix,
		stateless:                 options.Stateless,
		corsConfig:                options.CorsConfig,
		cancel:                    cancel,
		oauthConfig:               options.OAuthConfig,
		serverBaseURL:             options.ServerBaseURL,
		resourceDocumentation:     options.ResourceDocumentation,
		authMiddleware:            authMiddleware,
		upstreamSchemaSDL:         options.UpstreamSchemaSDL,
		upstreamHeaders:           options.UpstreamHeaders,
		watchOperations:           options.WatchOperations,
		operationsWatchInterval:   options.OperationsWatchInterval,
		ctx:                       ctx,
	}

	return gs, nil
}

// SetHTTPClient allows setting a custom HTTP client (useful for testing)
func (s *GraphQLSchemaServer) SetHTTPClient(client *http.Client) {
	s.httpClient = client
}

// WithGraphName sets the graph name
func WithGraphName(graphName string) func(*Options) {
	return func(o *Options) {
		o.GraphName = graphName
	}
}

// WithOperationsDir sets the operations directory
func WithOperationsDir(operationsDir string) func(*Options) {
	return func(o *Options) {
		o.OperationsDir = operationsDir
	}
}

// WithListenAddr sets the listen address
func WithListenAddr(listenAddr string) func(*Options) {
	return func(o *Options) {
		o.ListenAddr = listenAddr
	}
}

// WithPath sets the URL path this MCP server is mounted at (e.g. "/mcp", "/internal").
func WithPath(path string) func(*Options) {
	return func(o *Options) {
		o.Path = path
	}
}

// WithUpstreamSchemaSDL sets the SDL text used as this server's GraphQL schema.
// When set, Reload uses this schema instead of the supergraph schema passed in.
func WithUpstreamSchemaSDL(sdl string) func(*Options) {
	return func(o *Options) {
		o.UpstreamSchemaSDL = sdl
	}
}

// WithUpstreamHeaders sets headers forwarded to the upstream GraphQL endpoint
// on every request (in addition to per-request headers).
func WithUpstreamHeaders(headers map[string]string) func(*Options) {
	return func(o *Options) {
		o.UpstreamHeaders = headers
	}
}

// WithWatchOperations enables periodic scanning of the operations directory and
// hot-reload of MCP tools when files are added, modified, or removed.
func WithWatchOperations(enabled bool, interval time.Duration) func(*Options) {
	return func(o *Options) {
		o.WatchOperations = enabled
		o.OperationsWatchInterval = interval
	}
}

func WithLogger(logger *zap.Logger) func(*Options) {
	return func(o *Options) {
		o.Logger = logger
	}
}

// WithExcludeMutations sets the exclude mutations option
func WithExcludeMutations(excludeMutations bool) func(*Options) {
	return func(o *Options) {
		o.ExcludeMutations = excludeMutations
	}
}

// WithEnableArbitraryOperations sets the enable arbitrary operations option
func WithEnableArbitraryOperations(enableArbitraryOperations bool) func(*Options) {
	return func(o *Options) {
		o.EnableArbitraryOperations = enableArbitraryOperations
	}
}

// WithExposeSchema sets the expose schema option
func WithExposeSchema(exposeSchema bool) func(*Options) {
	return func(o *Options) {
		o.ExposeSchema = exposeSchema
	}
}

// WithStateless sets the stateless option
func WithStateless(stateless bool) func(*Options) {
	return func(o *Options) {
		o.Stateless = stateless
	}
}

// WithOmitToolNamePrefix sets the omit tool name prefix option
func WithOmitToolNamePrefix(omitToolNamePrefix bool) func(*Options) {
	return func(o *Options) {
		o.OmitToolNamePrefix = omitToolNamePrefix
	}
}

func WithCORS(corsCfg cors.Config) func(*Options) {
	return func(o *Options) {
		// Force specific CORS settings for MCP server
		corsCfg.AllowOrigins = []string{"*"}
		corsCfg.AllowMethods = []string{"GET", "PUT", "POST", "DELETE", "OPTIONS"}
		corsCfg.AllowHeaders = append(corsCfg.AllowHeaders, "Content-Type", "Accept", "Authorization", "Last-Event-ID", "Mcp-Protocol-Version", "Mcp-Session-Id")
		corsCfg.ExposeHeaders = append(corsCfg.ExposeHeaders, "Mcp-Session-Id", "WWW-Authenticate")
		if corsCfg.MaxAge <= 0 {
			corsCfg.MaxAge = 24 * time.Hour
		}
		o.CorsConfig = corsCfg
	}
}

// WithOAuth sets the OAuth configuration
func WithOAuth(oauthCfg *config.MCPOAuthConfiguration) func(*Options) {
	return func(o *Options) {
		o.OAuthConfig = oauthCfg
	}
}

// WithServerBaseURL sets the server base URL for OAuth discovery
func WithServerBaseURL(baseURL string) func(*Options) {
	return func(o *Options) {
		o.ServerBaseURL = baseURL
	}
}

// WithResourceDocumentation sets the human-readable documentation URL for RFC 9728 metadata
func WithResourceDocumentation(url string) func(*Options) {
	return func(o *Options) {
		o.ResourceDocumentation = url
	}
}

// RegisterRoutes registers this server's HTTP handlers (the MCP endpoint and,
// if OAuth is enabled, the RFC 9728 Protected Resource Metadata endpoint) on the
// given mux. The CORS middleware configured on this server is applied to its handlers.
//
// Use RegisterRoutes when mounting multiple MCP servers on a shared HTTP listener
// (see MultiServer). Use Serve when running a single server with its own listener.
func (s *GraphQLSchemaServer) RegisterRoutes(mux *http.ServeMux) {
	// Disable the SDK's built-in cross-origin protection (Sec-Fetch-Site check)
	// because the router already applies its own CORS middleware around the handler.
	cop := http.NewCrossOriginProtection()
	cop.AddInsecureBypassPattern("/{path...}")

	streamableHTTPHandler := mcp.NewStreamableHTTPHandler(
		func(req *http.Request) *mcp.Server {
			return s.server
		},
		&mcp.StreamableHTTPOptions{
			Stateless:             s.stateless,
			CrossOriginProtection: cop,
		},
	)

	middleware := cors.New(s.corsConfig)

	// OAuth 2.0 Protected Resource Metadata (RFC 9728) — per-resource discovery endpoint.
	// Each MCP server gets its own /.well-known/oauth-protected-resource{path} entry.
	if s.oauthConfig != nil && s.oauthConfig.Enabled && s.oauthConfig.AuthorizationServerURL != "" {
		mux.Handle("/.well-known/oauth-protected-resource"+s.path, middleware(http.HandlerFunc(s.handleProtectedResourceMetadata)))
	}

	// Inject request headers into context so tool handlers can forward them
	// to the GraphQL engine via headersFromContext.
	mcpHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(requestHeadersFromRequest(r.Context(), r))
		streamableHTTPHandler.ServeHTTP(w, r)
	})
	if s.authMiddleware != nil {
		mux.Handle(s.path, middleware(s.authMiddleware.HTTPMiddleware(mcpHandler)))
	} else {
		mux.Handle(s.path, middleware(mcpHandler))
	}
}

// Serve starts the server with the configured options and returns the HTTP server.
func (s *GraphQLSchemaServer) Serve() (*http.Server, error) {
	// Create custom HTTP server
	httpServer := &http.Server{
		Addr:         s.listenAddr,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	httpServer.Handler = mux

	logger := []zap.Field{
		zap.String("listen_addr", s.listenAddr),
		zap.String("path", s.path),
		zap.String("operations_dir", s.operationsDir),
		zap.String("graph_name", s.graphName),
		zap.Bool("exclude_mutations", s.excludeMutations),
		zap.Bool("enable_arbitrary_operations", s.enableArbitraryOperations),
		zap.Bool("expose_schema", s.exposeSchema),
	}

	s.logger.Info("MCP server started", logger...)

	go func() {
		defer s.logger.Info("MCP server stopped")

		err := httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start HTTP server", zap.Error(err))
		}
	}()

	return httpServer, nil
}

// Start loads operations and starts the server
func (s *GraphQLSchemaServer) Start() error {
	ss, err := s.Serve()
	if err != nil {
		return fmt.Errorf("failed to create HTTP server: %w", err)
	}

	s.httpServer = ss

	return nil
}

// Reload reloads the operations and schema, and computes per-tool scope
// requirements from @requiresScopes directives in the field configurations.
func (s *GraphQLSchemaServer) Reload(schema *ast.Document, fieldConfigs []*nodev1.FieldConfiguration) error {
	if s.server == nil {
		return fmt.Errorf("server is not started")
	}

	s.lastSchema = schema
	s.lastFieldConfigs = fieldConfigs
	s.schemaCompiler = NewSchemaCompiler(s.logger)
	s.operationsManager = NewOperationsManager(schema, s.logger, s.excludeMutations)

	if s.operationsDir != "" {
		if err := s.operationsManager.LoadOperationsFromDirectory(s.operationsDir); err != nil {
			return fmt.Errorf("failed to load operations: %w", err)
		}
	}

	// Compute per-tool scope requirements from @requiresScopes directives.
	// Only meaningful when OAuth is enabled; the scope extractor feeds the
	// auth middleware, which is only constructed alongside oauthConfig.
	if s.oauthConfig != nil && len(fieldConfigs) > 0 {
		maxScopeCombinations := s.oauthConfig.MaxScopeCombinations
		if err := s.operationsManager.ComputeToolScopes(fieldConfigs, maxScopeCombinations); err != nil {
			return fmt.Errorf("failed to compute tool scopes: %w", err)
		}
		s.authMiddleware.SetScopeExtractor(NewScopeExtractor(fieldConfigs, schema, maxScopeCombinations))
	}

	desired, err := s.buildDesiredTools()
	if err != nil {
		return fmt.Errorf("failed to build tool set: %w", err)
	}

	s.applyToolDiff(desired)

	return nil
}

// applyToolDiff applies the difference between the currently-registered tools
// (s.lastToolFingerprints) and the desired set. Tools whose fingerprint has not
// changed are left untouched — the SDK fires a tools/list_changed notification
// on every AddTool/RemoveTools call, so skipping unchanged tools keeps client
// chatter to a minimum and means an mtime-only file touch produces zero
// notifications.
func (s *GraphQLSchemaServer) applyToolDiff(desired map[string]desiredTool) {
	addNames := make([]string, 0, len(desired))
	for name := range desired {
		addNames = append(addNames, name)
	}
	sort.Strings(addNames)

	var added, changed []string
	for _, name := range addNames {
		d := desired[name]
		prev, existed := s.lastToolFingerprints[name]
		switch {
		case !existed:
			added = append(added, name)
		case prev != d.fingerprint:
			changed = append(changed, name)
		}
	}

	var removed []string
	for name := range s.lastToolFingerprints {
		if _, keep := desired[name]; !keep {
			removed = append(removed, name)
		}
	}
	sort.Strings(removed)

	// Apply the diff. RemoveTools batches into one notification; AddTool sends
	// one per call but we only invoke it for actually-changed tools.
	if len(removed) > 0 {
		s.server.RemoveTools(removed...)
	}
	for _, name := range added {
		d := desired[name]
		s.server.AddTool(d.tool, d.handler)
	}
	for _, name := range changed {
		d := desired[name]
		s.server.AddTool(d.tool, d.handler)
	}

	if len(added)+len(changed)+len(removed) == 0 {
		s.logger.Debug("MCP tool refresh: no changes detected, no notification sent to clients")
	} else {
		s.logger.Info("MCP tool refresh broadcast to connected clients (tools/list_changed)",
			zap.Strings("added", added),
			zap.Strings("changed", changed),
			zap.Strings("removed", removed),
			zap.Int("total_tools", len(desired)),
		)
	}

	// Remember the current state for the next reload's diff.
	s.lastToolFingerprints = make(map[string]string, len(desired))
	for name, d := range desired {
		s.lastToolFingerprints[name] = d.fingerprint
	}

	// Maintain s.registeredTools as a sorted slice for any code that still
	// reads it (collision detection in buildDesiredTools, etc.).
	s.registeredTools = s.registeredTools[:0]
	for _, name := range addNames {
		s.registeredTools = append(s.registeredTools, name)
	}
}

// Stop gracefully shuts down the MCP server
func (s *GraphQLSchemaServer) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return fmt.Errorf("server is not started")
	}

	s.logger.Debug("shutting down MCP server")

	// Cancel the server's context to stop background operations (e.g., JWKS key refresh)
	if s.cancel != nil {
		s.cancel()
	}

	// Create a shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to gracefully shutdown MCP server: %w", err)
	}

	return nil
}

// buildDesiredTools computes the full set of tools that should be registered
// with the MCP server given the current operations and config flags. It does
// NOT register them — the caller (Reload via applyToolDiff) compares against the
// previous set and only emits SDK Add/Remove calls for actual differences.
func (s *GraphQLSchemaServer) buildDesiredTools() (map[string]desiredTool, error) {
	desired := make(map[string]desiredTool)

	// get_schema — only when exposeSchema is enabled.
	if s.exposeSchema {
		schemaInput := map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}
		tool := &mcp.Tool{
			Name:        "get_schema",
			Description: "Provides the full GraphQL schema of the API.",
			InputSchema: schemaInput,
			Annotations: &mcp.ToolAnnotations{
				Title:        "Get GraphQL Schema",
				ReadOnlyHint: true,
			},
		}
		desired[tool.Name] = desiredTool{
			tool:        tool,
			handler:     s.handleGetGraphQLSchema(),
			fingerprint: fingerprintTool(tool, ""),
		}
	}

	// execute_graphql — only when arbitrary operations are enabled.
	if s.enableArbitraryOperations {
		execInput := map[string]any{
			"type":        "object",
			"description": "The query and variables to execute.",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The GraphQL query or mutation string to execute.",
				},
				"variables": map[string]any{
					"type":                 "object",
					"additionalProperties": true,
					"description":          "The variables to pass to the GraphQL query as a JSON object.",
				},
			},
			"additionalProperties": false,
			"required":             []string{"query"},
		}
		destructive := true
		openWorld := true
		tool := &mcp.Tool{
			Name:        "execute_graphql",
			Description: "Executes a GraphQL query or mutation.",
			InputSchema: execInput,
			Annotations: &mcp.ToolAnnotations{
				Title:           "Execute GraphQL Query",
				DestructiveHint: &destructive,
				IdempotentHint:  false,
				OpenWorldHint:   &openWorld,
			},
		}
		desired[tool.Name] = desiredTool{
			tool:        tool,
			handler:     s.handleExecuteGraphQL(),
			fingerprint: fingerprintTool(tool, ""),
		}
	}

	operations := s.operationsManager.GetFilteredOperations()
	graphqlOperationNames := make([]string, 0, len(operations))
	toolScopes := make(map[string][][]string)

	for _, op := range operations {
		var compiledSchema *jsonschema.Schema
		var err error

		graphqlOperationNames = append(graphqlOperationNames, op.Name)

		if len(op.JSONSchema) > 0 {
			if err := s.schemaCompiler.ValidateJSONSchema(op.JSONSchema); err != nil {
				s.logger.Error("invalid schema for operation",
					zap.String("operation", op.Name), zap.Error(err))
				continue
			}
			schemaName := fmt.Sprintf("schema-%s.json", op.Name)
			compiledSchema, err = s.schemaCompiler.CompileJSONSchema(op.JSONSchema, schemaName)
			if err != nil {
				s.logger.Error("failed to compile schema for operation",
					zap.String("operation", op.Name), zap.Error(err))
				continue
			}
		}

		handler := &operationHandler{operation: op, compiledSchema: compiledSchema}

		operationToolName := strcase.ToSnake(op.Name)
		toolName := operationToolName
		if !s.omitToolNamePrefix {
			toolName = fmt.Sprintf("execute_operation_%s", operationToolName)
		} else if _, dup := desired[operationToolName]; dup || slices.Contains(reservedToolNames, operationToolName) {
			s.logger.Error("Skipping operation due to tool name collision",
				zap.String("operation", op.Name),
				zap.String("conflicting_tool", operationToolName))
			continue
		}

		var toolDescription string
		if op.Description != "" {
			toolDescription = op.Description
		} else {
			toolDescription = fmt.Sprintf("Executes the GraphQL operation '%s' of type %s.", op.Name, op.OperationType)
		}

		var inputSchema any
		if len(op.JSONSchema) > 0 {
			if err := json.Unmarshal(op.JSONSchema, &inputSchema); err != nil {
				s.logger.Error("failed to parse JSON schema for operation",
					zap.String("operation", op.Name), zap.Error(err))
				continue
			}
		} else {
			inputSchema = map[string]any{"type": "object", "properties": map[string]any{}}
		}

		openWorld := true
		tool := &mcp.Tool{
			Name:        toolName,
			Description: toolDescription,
			InputSchema: inputSchema,
			Annotations: &mcp.ToolAnnotations{
				IdempotentHint: op.OperationType != "mutation",
				Title:          fmt.Sprintf("Execute operation %s", op.Name),
				ReadOnlyHint:   op.OperationType == "query",
				OpenWorldHint:  &openWorld,
			},
		}

		// Per-operation tools incorporate the query body and required scopes
		// into the fingerprint, so editing the operation triggers a re-add and
		// editing whitespace alone does not (the parser normalizes the body).
		extra := op.OperationString + scopesFingerprint(op.RequiredScopes)
		desired[toolName] = desiredTool{
			tool:        tool,
			handler:     s.handleOperation(handler),
			fingerprint: fingerprintTool(tool, extra),
		}

		if len(op.RequiredScopes) > 0 {
			toolScopes[toolName] = op.RequiredScopes
		}
	}

	if s.authMiddleware != nil {
		s.authMiddleware.SetToolScopes(toolScopes)
	}

	// get_operation_info — always present, but its description includes the list
	// of operation names, so its fingerprint changes when operations are added or
	// removed (correctly triggering a notification only when the enum actually shifts).
	sort.Strings(graphqlOperationNames)
	getOpInfo := &mcp.Tool{
		Name:        "get_operation_info",
		Description: "Provides instructions on how to execute the GraphQL operation via HTTP and how to integrate it into your application.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operationName": map[string]any{
					"type":        "string",
					"description": "The exact name of the GraphQL operation to retrieve information for.",
					"enum":        graphqlOperationNames,
				},
			},
			"required": []string{"operationName"},
		},
		Annotations: &mcp.ToolAnnotations{
			Title:        "Get GraphQL Operation Info",
			ReadOnlyHint: true,
		},
	}
	desired[getOpInfo.Name] = desiredTool{
		tool:        getOpInfo,
		handler:     s.handleGraphQLOperationInfo(),
		fingerprint: fingerprintTool(getOpInfo, ""),
	}

	// code_mode_run_js — when at least one operation is loaded, expose a single
	// V8-sandboxed tool where every operation is bound as `tools.<name>(vars)`.
	// Lets an LLM compose multiple ops in one round-trip instead of N MCP calls.
	if len(operations) > 0 {
		codeModeTool := s.codeModeToolDescriptor()
		desired[codeModeTool.Name] = desiredTool{
			tool:        codeModeTool,
			handler:     s.handleCodeModeRunJS(),
			fingerprint: fingerprintTool(codeModeTool, fmt.Sprintf("ops=%d", len(operations))),
		}
	}

	return desired, nil
}

// fingerprintTool computes a stable hash of the tool's user-visible content:
// name, description, input schema, annotations, plus an operation-specific extra
// (query body + scopes for operation tools, empty for built-ins).
//
// Two tools with the same fingerprint produce identical tools/list and
// tools/call experiences for an MCP client — so we can skip re-registering
// (and skip the tools/list_changed notification).
func fingerprintTool(t *mcp.Tool, extra string) string {
	h := sha256.New()
	h.Write([]byte(t.Name))
	h.Write([]byte{0})
	h.Write([]byte(t.Description))
	h.Write([]byte{0})
	if t.InputSchema != nil {
		if buf, err := json.Marshal(t.InputSchema); err == nil {
			h.Write(buf)
		}
	}
	h.Write([]byte{0})
	if t.Annotations != nil {
		if buf, err := json.Marshal(t.Annotations); err == nil {
			h.Write(buf)
		}
	}
	h.Write([]byte{0})
	h.Write([]byte(extra))
	return hex.EncodeToString(h.Sum(nil))
}

// scopesFingerprint produces a stable string for an OR-of-AND scope list.
func scopesFingerprint(scopes [][]string) string {
	if len(scopes) == 0 {
		return ""
	}
	cp := make([][]string, len(scopes))
	for i, group := range scopes {
		grp := make([]string, len(group))
		copy(grp, group)
		sort.Strings(grp)
		cp[i] = grp
	}
	sort.Slice(cp, func(i, j int) bool {
		return strings.Join(cp[i], ",") < strings.Join(cp[j], ",")
	})
	parts := make([]string, len(cp))
	for i, grp := range cp {
		parts[i] = strings.Join(grp, "&")
	}
	return strings.Join(parts, "|")
}

// handleOperation handles a specific operation
func (s *GraphQLSchemaServer) handleOperation(handler *operationHandler) func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Log authenticated user if OAuth is enabled
		if claims, ok := GetClaimsFromContext(ctx); ok {
			s.logger.Debug("operation called by authenticated user",
				zap.String("sub", getClaimString(claims, "sub")),
				zap.String("email", getClaimString(claims, "email")),
				zap.String("operation", handler.operation.Name))
		}

		jsonBytes := request.Params.Arguments

		// Validate the JSON input against the pre-compiled schema derived from the operation input type
		if handler.compiledSchema != nil {
			if err := s.schemaCompiler.ValidateInput(jsonBytes, handler.compiledSchema); err != nil {
				return &mcp.CallToolResult{
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Input validation error: %v", err)}},
					IsError: true,
				}, nil
			}
		}

		// Execute the operation with the provided variables
		return s.executeGraphQLQuery(ctx, handler.operation.OperationString, jsonBytes)
	}
}

// handleGraphQLOperationInfo returns a handler function that provides detailed info for a specific operation.
func (s *GraphQLSchemaServer) handleGraphQLOperationInfo() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input GraphQLOperationInfoInput
		inputBytes := request.Params.Arguments
		if err := json.Unmarshal(inputBytes, &input); err != nil {
			return nil, fmt.Errorf(`failed to unmarshal input arguments: %w. Ensure you provide {"operationName": "<n>"}`, err)
		}

		if input.OperationName == "" {
			return nil, fmt.Errorf("input validation failed: operationName is required")
		}

		targetOp := s.operationsManager.GetOperation(input.OperationName)
		if targetOp == nil {
			return nil, fmt.Errorf("operation '%s' not found or excluded by configuration", input.OperationName)
		}

		// Operation overview section
		overview := fmt.Sprintf("Operation: %s\nType: %s\n", targetOp.Name, targetOp.OperationType)
		if targetOp.Description != "" {
			overview += fmt.Sprintf("Description: %s\n", targetOp.Description)
		}

		// Schema information section
		var schemaInfo string
		if len(targetOp.JSONSchema) > 0 {
			schemaInfo = fmt.Sprintf("\nInput Schema:\n```json\n%s\n```\n", targetOp.JSONSchema)
		} else {
			schemaInfo = "\nThis operation does not require any input variables.\n"
		}

		// Query section
		queryInfo := fmt.Sprintf("\nGraphQL Query:\n```\n%s\n```\n", targetOp.OperationString)

		// Usage instructions section
		usageInstructions := fmt.Sprintf(`
Usage Instructions:
1. Endpoint: %s
2. HTTP Method: POST
3. Headers Required:
   - Content-Type: application/json; charset=utf-8
`, s.routerGraphQLEndpoint)

		// Request format section
		requestFormat := "\nRequest Format:\n```json\n"
		if len(targetOp.JSONSchema) > 0 {
			requestFormat += `{
  "query": "<operation_query>",
  "variables": <your_variables_object>
}
`
		} else {
			requestFormat += `{
  "query": "<operation_query>"
}
`
		}
		requestFormat += "```"

		// Scope requirements section
		var scopeInfo string
		if len(targetOp.RequiredScopes) > 0 {
			scopeInfo = "\nRequired Scopes (OR-of-AND):\n"
			for i, andGroup := range targetOp.RequiredScopes {
				if i > 0 {
					scopeInfo += "  OR\n"
				}
				scopeInfo += fmt.Sprintf("  - %s\n", strings.Join(andGroup, " AND "))
			}
		}

		// Important notes section
		importantNotes := `
Important Notes:
1. Use the query string exactly as provided above
2. Do not modify or reformat the query string`

		// Combine all sections
		response := overview + schemaInfo + scopeInfo + queryInfo + usageInstructions + requestFormat + importantNotes

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: response}},
		}, nil
	}
}

// executeGraphQLQuery executes a GraphQL query against the router endpoint
func (s *GraphQLSchemaServer) executeGraphQLQuery(ctx context.Context, query string, variables json.RawMessage) (*mcp.CallToolResult, error) {
	// Create the GraphQL request
	graphqlRequest := graphqlRequest{
		Query:     query,
		Variables: variables,
	}

	graphqlRequestBytes, err := json.Marshal(graphqlRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	req, err := http.NewRequest("POST", s.routerGraphQLEndpoint, bytes.NewReader(graphqlRequestBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Forward all headers from the original MCP request to the GraphQL server
	// The router's header forwarding rules will then determine what gets sent to subgraphs
	reqHeaders, err := headersFromContext(ctx)
	if err != nil {
		s.logger.Debug("failed to get headers from context", zap.Error(err))
	} else {
		// Copy all headers from the MCP request
		for key, values := range reqHeaders {
			// Skip headers that should not be forwarded
			if _, ok := headers.SkippedHeaders[key]; ok {
				continue
			}
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

	// Override specific headers that must be set for GraphQL requests
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Parse the GraphQL response
	var graphqlResponse GraphQLResponse

	if err := json.Unmarshal(body, &graphqlResponse); err == nil && len(graphqlResponse.Errors) > 0 {
		// Concatenate all error messages
		var errorMessages []string
		for _, gqlErr := range graphqlResponse.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}

		errorMessage := strings.Join(errorMessages, "; ")

		// If there are errors but no data, return only the errors
		if len(graphqlResponse.Data) == 0 || string(graphqlResponse.Data) == "null" {
			return &mcp.CallToolResult{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Response error: %s", errorMessage)}},
				IsError: true,
			}, nil
		}

		// If we have both errors and data, include data in the error message
		dataString := string(graphqlResponse.Data)
		combinedErrorMsg := fmt.Sprintf("Response error with partial success, Error: %s, Data: %s)", errorMessage, dataString)
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: combinedErrorMsg}},
			IsError: true,
		}, nil
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(body)}},
	}, nil
}

// handleExecuteGraphQL returns a handler function that executes arbitrary GraphQL queries
func (s *GraphQLSchemaServer) handleExecuteGraphQL() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Log authenticated user if OAuth is enabled
		if claims, ok := GetClaimsFromContext(ctx); ok {
			s.logger.Debug("arbitrary GraphQL query called by authenticated user",
				zap.String("sub", getClaimString(claims, "sub")),
				zap.String("email", getClaimString(claims, "email")))
		}

		// Parse the JSON input
		jsonBytes := request.Params.Arguments

		var input ExecuteGraphQLInput
		if err := json.Unmarshal(jsonBytes, &input); err != nil {
			return nil, fmt.Errorf("failed to unmarshal input arguments: %w", err)
		}

		if input.Query == "" {
			return nil, fmt.Errorf("input validation failed: query is required")
		}

		return s.executeGraphQLQuery(ctx, input.Query, input.Variables)
	}
}

// handleGetGraphQLSchema returns a handler function that returns the full GraphQL schema
func (s *GraphQLSchemaServer) handleGetGraphQLSchema() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Get the schema from the operations manager
		schema := s.operationsManager.GetSchema()
		if schema == nil {
			return nil, fmt.Errorf("GraphQL schema is not available")
		}

		// Convert the AST document to a string representation
		schemaStr, err := astprinter.PrintString(schema)
		if err != nil {
			return nil, fmt.Errorf("failed to convert schema to string: %w", err)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: schemaStr}},
		}, nil
	}
}

// getClaimString safely extracts a string value from claims
func getClaimString(claims authentication.Claims, key string) string {
	if val, ok := claims[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

// ProtectedResourceMetadata represents the OAuth 2.0 Protected Resource Metadata (RFC 9728)
type ProtectedResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	BearerMethodsSupported []string `json:"bearer_methods_supported,omitempty"`
	ResourceDocumentation  string   `json:"resource_documentation,omitempty"`
	ScopesSupported        []string `json:"scopes_supported"`
}

// handleProtectedResourceMetadata handles the OAuth 2.0 Protected Resource Metadata endpoint
// as specified in RFC 9728. This endpoint allows MCP clients to discover the authorization
// server(s) associated with this resource server.
func (s *GraphQLSchemaServer) handleProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Determine the resource URL (this MCP server's base URL)
	resourceURL := s.serverBaseURL
	if resourceURL == "" {
		// Fallback: construct from request if not configured
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		resourceURL = fmt.Sprintf("%s://%s", scheme, r.Host)
	}

	// Build scopes_supported from all configured scopes (union across all levels)
	// plus all scopes extracted from @requiresScopes directives on operations
	scopesSet := make(map[string]bool)
	// Collect all static scope lists, conditionally including built-in tool scopes
	// based on whether the corresponding feature is enabled
	scopeLists := [][]string{
		s.oauthConfig.Scopes.Initialize,
		s.oauthConfig.Scopes.ToolsList,
		s.oauthConfig.Scopes.ToolsCall,
		s.oauthConfig.Scopes.GetOperationInfo, // get_operation_info is always available
	}
	if s.enableArbitraryOperations {
		scopeLists = append(scopeLists, s.oauthConfig.Scopes.ExecuteGraphQL)
	}
	if s.exposeSchema {
		scopeLists = append(scopeLists, s.oauthConfig.Scopes.GetSchema)
	}

	for _, scopeList := range scopeLists {
		for _, scope := range scopeList {
			scopesSet[scope] = true
		}
	}

	// Include all scopes from per-tool @requiresScopes extraction
	if s.operationsManager != nil {
		for _, op := range s.operationsManager.GetOperations() {
			for _, andGroup := range op.RequiredScopes {
				for _, scope := range andGroup {
					scopesSet[scope] = true
				}
			}
		}
	}

	// Convert set to sorted slice for consistent output
	scopes := make([]string, 0, len(scopesSet))
	for scope := range scopesSet {
		scopes = append(scopes, scope)
	}
	slices.Sort(scopes)
	if len(scopes) == 0 {
		scopes = []string{} // Ensure non-nil for JSON encoding
	}

	mcpResourceURL := strings.TrimRight(resourceURL, "/") + s.path

	metadata := ProtectedResourceMetadata{
		Resource:               mcpResourceURL,
		AuthorizationServers:   []string{s.oauthConfig.AuthorizationServerURL},
		BearerMethodsSupported: []string{"header"},
		ResourceDocumentation:  s.resourceDocumentation,
		ScopesSupported:        scopes,
	}

	// Encode to buffer first so we can handle errors before writing headers
	data, err := json.Marshal(metadata)
	if err != nil {
		s.logger.Error("failed to encode protected resource metadata", zap.Error(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// GetResourceMetadataURL returns the URL for the OAuth 2.0 Protected Resource Metadata endpoint
func (s *GraphQLSchemaServer) GetResourceMetadataURL() string {
	if s.serverBaseURL != "" {
		return fmt.Sprintf("%s/.well-known/oauth-protected-resource%s", s.serverBaseURL, s.path)
	}
	return ""
}

// Path returns the URL path this MCP server is mounted at.
func (s *GraphQLSchemaServer) Path() string { return s.path }

// Name returns the configured graph name (used in metrics/logs).
func (s *GraphQLSchemaServer) Name() string { return s.graphName }

// HasUpstreamSchema reports whether this server uses an SDL-provided upstream schema
// (i.e. it does not track the local supergraph schema).
func (s *GraphQLSchemaServer) HasUpstreamSchema() bool { return s.upstreamSchemaSDL != "" }

// OperationsDir returns the configured operations directory for this server,
// or "" if no storage provider is wired up.
func (s *GraphQLSchemaServer) OperationsDir() string { return s.operationsDir }

// WatchSettings returns the operations-directory watcher configuration.
// (enabled, interval). Used by MultiServer to start watchers after Reload.
func (s *GraphQLSchemaServer) WatchSettings() (bool, time.Duration) {
	return s.watchOperations, s.operationsWatchInterval
}

// Context returns the per-server context (cancelled on Stop). Used by
// background goroutines (operations watcher, etc.) to know when to exit.
func (s *GraphQLSchemaServer) Context() context.Context { return s.ctx }

// ReloadOperations re-reads the operations directory using the most recently
// loaded schema and field configurations. Used by the per-collection storage
// directory watcher to hot-reload tools when files change. Safe to call
// before any initial Reload — in that case it returns an error rather than
// panicking on a nil schema.
func (s *GraphQLSchemaServer) ReloadOperations() error {
	if s.lastSchema == nil {
		return fmt.Errorf("ReloadOperations called before initial Reload")
	}
	return s.Reload(s.lastSchema, s.lastFieldConfigs)
}
