package connect_rpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/router/pkg/connect_rpc/proxy"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"go.uber.org/zap"
)

type ConnectRPCServer struct {
	logger                *zap.Logger
	graphqlClient         *proxy.Client
	listenAddr            string
	requestTimeout        time.Duration
	routerGraphQLEndpoint string
	collectionDirectory   string
	collection            map[string]schemaloader.Operation
	packageName           string
	serviceName           string
}

type Options struct {
	Logger                *zap.Logger
	ListenAddr            string
	GraphQLClient         *proxy.Client
	RequestTimeout        time.Duration
	RouterGraphQLEndpoint string
	CollectionDir         string
	PackageName           string
	ServiceNane           string
}

func WithLogger(logger *zap.Logger) func(*Options) {
	return func(o *Options) {
		o.Logger = logger
	}
}

func WithListenAddress(address string) func(*Options) {
	return func(o *Options) {
		o.ListenAddr = address
	}
}

func WithCollectionDir(dir string) func(*Options) {
	return func(o *Options) {
		o.CollectionDir = dir
	}
}

func WithPackageName(packageName string) func(*Options) {
	return func(o *Options) {
		o.PackageName = packageName
	}
}

func WithGraphQLClient(client *proxy.Client) func(*Options) {
	return func(o *Options) {
		o.GraphQLClient = client
	}
}

func WithServiceName(serviceName string) func(*Options) {
	return func(o *Options) {
		o.ServiceNane = serviceName
	}
}

func NewConnectRPCServer(opts ...func(*Options)) *ConnectRPCServer {

	options := &Options{
		Logger:         zap.NewNop(),
		RequestTimeout: 10 * time.Second,
		CollectionDir:  "./operations",
	}

	for _, opt := range opts {
		if opt != nil {
			opt(options)
		}
	}

	return &ConnectRPCServer{
		logger:                options.Logger,
		requestTimeout:        options.RequestTimeout,
		routerGraphQLEndpoint: options.RouterGraphQLEndpoint,
		collectionDirectory:   options.CollectionDir,
		packageName:           options.PackageName,
		serviceName:           options.ServiceNane,
		listenAddr:            options.ListenAddr,
		graphqlClient:         options.GraphQLClient,
	}
}

func (s *ConnectRPCServer) RegisterHandlers(mux *http.ServeMux) {
	for operationName, operation := range s.collection {
		op := operation

		listenPath := fmt.Sprintf("/%s.%s/%s", s.packageName, s.serviceName, operationName)

		s.logger.Info("registering handler", zap.String("path", listenPath))

		handler := s.createOperationHandler(op)
		mux.Handle(listenPath, handler)
	}
}

// createOperationHandler creates a Connect RPC handler for a specific GraphQL operation
func (s *ConnectRPCServer) createOperationHandler(operation schemaloader.Operation) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Handle Connect RPC protocol
		s.handleConnectRPC(w, r, operation)
	})
}

// handleConnectRPC handles the Connect RPC protocol for a specific operation
func (s *ConnectRPCServer) handleConnectRPC(w http.ResponseWriter, r *http.Request, operation schemaloader.Operation) {
	// Validate Connect RPC headers
	if !s.validateConnectHeaders(r) {
		s.writeConnectError(w, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid Connect RPC headers")))
		return
	}

	// Parse the request body based on content type
	connectRequest, err := s.parseConnectRequest(r)
	if err != nil {
		s.writeConnectError(w, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to parse request: %w", err)))
		return
	}

	// Map Connect RPC request to GraphQL variables
	variables, err := s.mapConnectRequestToGraphQLVariables(connectRequest, operation)
	if err != nil {
		s.writeConnectError(w, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("variable mapping failed: %w", err)))
		return
	}

	// Execute the GraphQL operation
	gqlResp, err := s.graphqlClient.ExecuteOperation(r.Context(), operation.Document, operation.Name, variables)
	if err != nil {
		s.writeConnectError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("GraphQL execution failed: %w", err)))
		return
	}

	// Check for GraphQL errors
	if len(gqlResp.Errors) > 0 {
		connectErr := proxy.GraphQLErrorToConnectError(gqlResp.Errors)
		s.writeConnectError(w, connectErr)
		return
	}

	// Write successful response
	s.writeConnectSuccess(w, r, gqlResp.Data)
}

// validateConnectHeaders validates Connect RPC protocol headers
func (s *ConnectRPCServer) validateConnectHeaders(r *http.Request) bool {
	// Check Content-Type
	contentType := r.Header.Get("Content-Type")
	if contentType != "application/json" && contentType != "application/proto" {
		return false
	}

	// Connect-Protocol-Version is optional but recommended
	// we dont require it for the PoC

	return true
}

// parseConnectRequest parses the Connect RPC request body
func (s *ConnectRPCServer) parseConnectRequest(r *http.Request) (map[string]interface{}, error) {
	contentType := r.Header.Get("Content-Type")

	switch contentType {
	case "application/json":
		return s.parseJSONRequest(r)
	case "application/proto":
		// For the PoC, we'll focus on JSON support
		// Proto support can be added later
		return nil, fmt.Errorf("protobuf content type not yet supported in PoC")
	default:
		return nil, fmt.Errorf("unsupported content type: %s", contentType)
	}
}

// parseJSONRequest parses a JSON Connect RPC request
func (s *ConnectRPCServer) parseJSONRequest(r *http.Request) (map[string]interface{}, error) {
	var requestData map[string]interface{}

	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		return nil, fmt.Errorf("failed to decode JSON request: %w", err)
	}

	return requestData, nil
}

// mapConnectRequestToGraphQLVariables maps Connect RPC request fields to GraphQL variables
func (s *ConnectRPCServer) mapConnectRequestToGraphQLVariables(connectRequest map[string]interface{}, operation schemaloader.Operation) (map[string]interface{}, error) {
	// TODO: Add support for JSON Schema validation
	// Validate input against JSON Schema if available

	//if operation.CompiledSchema != nil {
	//	if err := s.validateInputWithSchema(connectRequest, operation.CompiledSchema); err != nil {
	//		return nil, fmt.Errorf("input validation failed: %w", err)
	//	}
	//}

	return connectRequest, nil
}

//// validateInputWithSchema validates input data against a compiled JSON Schema
//func (s *ConnectRPCServer) validateInputWithSchema(data interface{}, schema *jsonschema.Schema) error {
//	if schema == nil {
//		return nil
//	}
//
//	if err := schema.Validate(data); err != nil {
//		var validationErr *jsonschema.ValidationError
//		if errors.As(err, &validationErr) {
//			// Return a more user-friendly error message
//			return fmt.Errorf("validation error at '%s': %s", validationErr.InstanceLocation, validationErr.Error())
//		}
//		return fmt.Errorf("schema validation failed: %w", err)
//	}
//
//	return nil
//}

// mapFieldNameDynamic maps Connect RPC field names to GraphQL variable names using dynamic mapping
func (s *ConnectRPCServer) mapFieldNameDynamic(connectField string, variableMapping map[string]string) string {
	// First check if we have a specific mapping for this field
	if graphqlVar, exists := variableMapping[connectField]; exists {
		return graphqlVar
	}

	// If no specific mapping found, return as-is (for fields that don't need mapping)
	return connectField
}

// writeConnectError writes a Connect RPC error response
func (s *ConnectRPCServer) writeConnectError(w http.ResponseWriter, err *connect.Error) {
	// Set appropriate HTTP status code based on Connect error code
	httpStatus := connectCodeToHTTPStatus(err.Code())

	// Set headers
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)

	// Create error response
	errorResp := map[string]interface{}{
		"code":    err.Code().String(),
		"message": err.Message(),
	}

	json.NewEncoder(w).Encode(errorResp)
}

// writeConnectSuccess writes a successful Connect RPC response
func (s *ConnectRPCServer) writeConnectSuccess(w http.ResponseWriter, r *http.Request, data interface{}) {
	// Set headers
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Write the GraphQL data directly as the Connect RPC response
	// In a real implementation with generated protos, this would be properly typed
	json.NewEncoder(w).Encode(data)
}

// connectCodeToHTTPStatus maps Connect error codes to HTTP status codes
func connectCodeToHTTPStatus(code connect.Code) int {
	switch code {
	case connect.CodeCanceled:
		return 499 // Client Closed Request
	case connect.CodeUnknown:
		return http.StatusInternalServerError
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest
	case connect.CodeDeadlineExceeded:
		return http.StatusGatewayTimeout
	case connect.CodeNotFound:
		return http.StatusNotFound
	case connect.CodeAlreadyExists:
		return http.StatusConflict
	case connect.CodePermissionDenied:
		return http.StatusForbidden
	case connect.CodeResourceExhausted:
		return http.StatusTooManyRequests
	case connect.CodeFailedPrecondition:
		return http.StatusBadRequest
	case connect.CodeAborted:
		return http.StatusConflict
	case connect.CodeOutOfRange:
		return http.StatusBadRequest
	case connect.CodeUnimplemented:
		return http.StatusNotImplemented
	case connect.CodeInternal:
		return http.StatusInternalServerError
	case connect.CodeUnavailable:
		return http.StatusServiceUnavailable
	case connect.CodeDataLoss:
		return http.StatusInternalServerError
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized
	default:
		return http.StatusInternalServerError
	}
}

// GetOperationInfo returns information about loaded operations (for debugging)
func (s *ConnectRPCServer) GetOperationInfo() map[string]interface{} {
	info := make(map[string]interface{})

	for name, op := range s.collection {
		info[name] = map[string]interface{}{
			"name":     op.Name,
			"type":     op.OperationType,
			"filePath": op.FilePath,
			"endpoint": fmt.Sprintf("/%s.%s/%s", s.packageName, s.serviceName, name),
		}
	}

	return info
}

func (s *ConnectRPCServer) LoadOperations() error {
	collection := NewCollection(s.logger)

	if err := collection.LoadFromDirectory(s.collectionDirectory); err != nil {
		return fmt.Errorf("failed to load operations from directory %s: %w", s.collectionDirectory, err)
	}

	s.collection = collection.operations

	s.logger.Info("loaded operations",
		zap.Int("count", len(s.collection)))

	return nil
}

func (s *ConnectRPCServer) Start() error {
	if err := s.LoadOperations(); err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	mux := http.NewServeMux()

	s.RegisterHandlers(mux)

	server := &http.Server{
		Addr:         s.listenAddr,
		ReadTimeout:  s.requestTimeout,
		WriteTimeout: s.requestTimeout,
		Handler:      mux,
	}

	s.logger.Info("starting Connect RPC server",
		zap.String("listen_addr", s.listenAddr))

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("failed to start Connect RPC server", zap.Error(err))
		}
	}()

	return nil
}
