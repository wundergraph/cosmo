package connectrpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"connectrpc.com/vanguard"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// VanguardServiceConfig holds configuration for creating a Vanguard service
type VanguardServiceConfig struct {
	Handler     *RPCHandler
	ProtoLoader *ProtoLoader
	Logger      *zap.Logger
}

// VanguardService wraps the RPC handler and creates Vanguard services that enable
// protocol-agnostic RPC handling. It uses the connectrpc.com/vanguard package to provide
// automatic transcoding between different RPC protocols (gRPC, gRPC-Web, Connect, and REST)
// and message formats (Protocol Buffers binary, JSON, etc.).
//
// The service acts as a protocol adapter that:
//   - Accepts requests in any supported RPC protocol (gRPC, gRPC-Web, Connect, REST)
//   - Transcodes incoming requests to Connect protocol with JSON encoding
//   - Forwards the normalized request to the underlying RPCHandler for GraphQL execution
//   - Transcodes the response back to the client's original protocol and format
//
// This allows clients to use their preferred RPC protocol while the router internally
// processes all requests uniformly as Connect+JSON, simplifying the handler implementation
// and enabling protocol interoperability.
type VanguardService struct {
	handler     *RPCHandler
	protoLoader *ProtoLoader
	logger      *zap.Logger
	services    []*vanguard.Service
}

// NewVanguardService creates a new Vanguard service wrapper
func NewVanguardService(config VanguardServiceConfig) (*VanguardService, error) {
	if config.Handler == nil {
		return nil, fmt.Errorf("handler cannot be nil")
	}

	if config.ProtoLoader == nil {
		return nil, fmt.Errorf("proto loader cannot be nil")
	}

	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	vs := &VanguardService{
		handler:     config.Handler,
		protoLoader: config.ProtoLoader,
		logger:      config.Logger,
	}

	// Register all proto services with Vanguard
	if err := vs.registerServices(); err != nil {
		return nil, fmt.Errorf("failed to register services: %w", err)
	}

	return vs, nil
}

// registerServices creates Vanguard services for all proto services
func (vs *VanguardService) registerServices() error {
	protoServices := vs.protoLoader.GetServices()
	if len(protoServices) == 0 {
		return fmt.Errorf("no proto services found")
	}

	// Create a custom type resolver from our Files registry
	// This avoids using the global registry
	files := vs.protoLoader.GetFiles()
	customTypes := dynamicpb.NewTypes(files)

	vs.services = make([]*vanguard.Service, 0, len(protoServices))

	// Collect aggregate statistics
	totalMethods := 0
	uniquePackages := make(map[string]bool)
	for _, serviceDef := range protoServices {
		totalMethods += len(serviceDef.Methods)
		uniquePackages[serviceDef.Package] = true
	}

	// Log aggregate summary at Info level
	vs.logger.Info("registering services",
		zap.Int("package_count", len(uniquePackages)),
		zap.Int("service_count", len(protoServices)),
		zap.Int("total_methods", totalMethods))

	for serviceName, serviceDef := range protoServices {
		vs.logger.Debug("registering service",
			zap.String("service_name", serviceName),
			zap.String("full_name", serviceDef.FullName),
			zap.Int("method_count", len(serviceDef.Methods)))

		// Log all methods for this service at Debug level
		for _, method := range serviceDef.Methods {
			vs.logger.Debug("service method",
				zap.String("service", serviceName),
				zap.String("method", method.Name),
				zap.String("input_type", method.InputType),
				zap.String("output_type", method.OutputType))
		}

		// Create an HTTP handler for this service
		// The handler will receive requests at paths like: /Method (without the service prefix)
		serviceHandler := vs.createServiceHandler(serviceName, serviceDef)

		// Use NewServiceWithSchema with custom type resolver
		// This avoids relying on the global registry
		servicePath := "/" + serviceName + "/"

		vs.logger.Debug("creating service with custom type resolver",
			zap.String("service_path", servicePath))

		// Configure to always transcode to Connect protocol with JSON codec
		// This ensures our handler always receives JSON, regardless of the incoming protocol
		// Use NewServiceWithSchema to provide the schema directly with a custom type resolver
		vanguardService := vanguard.NewServiceWithSchema(
			serviceDef.ServiceDescriptor,
			serviceHandler,
			vanguard.WithTargetProtocols(vanguard.ProtocolConnect),
			vanguard.WithTargetCodecs("json"),
			vanguard.WithTypeResolver(customTypes),
		)

		vs.services = append(vs.services, vanguardService)

		vs.logger.Debug("registered service successfully with custom type resolver",
			zap.String("service", serviceName),
			zap.String("service_path", servicePath),
			zap.String("target_protocol", "connect"),
			zap.String("target_codec", "json"))
	}

	return nil
}

// createServiceHandler creates an HTTP handler for a specific proto service
// This handler is wrapped by Vanguard, which handles protocol transcoding
func (vs *VanguardService) createServiceHandler(serviceName string, serviceDef *ServiceDefinition) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract and validate method name from path
		methodName := vs.extractMethodName(r.URL.Path, serviceName)
		if methodName == "" {
			// Return Connect error for invalid path
			connectErr := connect.NewError(connect.CodeNotFound, fmt.Errorf("invalid path format"))
			vs.writeConnectError(w, connectErr, serviceName, methodName)
			return
		}

		// Validate method exists in service
		methodExists := false
		for _, method := range serviceDef.Methods {
			if method.Name == methodName {
				methodExists = true
				break
			}
		}

		if !methodExists {
			// Return Connect error for method not found
			connectErr := connect.NewError(connect.CodeNotFound, fmt.Errorf("method not found: %s", methodName))
			vs.writeConnectError(w, connectErr, serviceName, methodName)
			return
		}

		// For GET requests (Connect protocol), extract message from query parameter
		// For POST requests, read from body
		var requestBody []byte
		var err error

		if r.Method == "GET" {
			// Extract the 'message' query parameter (Connect protocol for GET requests)
			messageParam := r.URL.Query().Get("message")
			if messageParam == "" {
				// For methods with no input parameters, use empty JSON object
				requestBody = []byte("{}")
			} else {
				// The message parameter is already URL-decoded by r.URL.Query().Get()
				requestBody = []byte(messageParam)
			}
			vs.logger.Debug("extracted message from GET query parameter",
				zap.String("message", string(requestBody)))
		} else {
			// Read request body (JSON for POST requests)
			requestBody, err = io.ReadAll(r.Body)
			if err != nil {
				vs.logger.Error("failed to read request body", zap.Error(err))
				connectErr := connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to read request"))
				vs.writeConnectError(w, connectErr, serviceName, methodName)
				return
			}
		}

		// Add headers to context for forwarding to GraphQL
		ctx := withRequestHeaders(r.Context(), r.Header)

		// Handle the RPC request
		responseBody, err := vs.handler.HandleRPC(ctx, serviceName, methodName, requestBody)
		if err != nil {
			// Check if this is already a Connect error
			var connectErr *connect.Error
			if errors.As(err, &connectErr) {
				vs.writeConnectError(w, connectErr, serviceName, methodName)
			} else {
				// Log the original error with full details for diagnostics
				vs.logger.Error("internal error during RPC handling",
					zap.String("service", serviceName),
					zap.String("method", methodName),
					zap.Error(err))

				// Return a sanitized error to the client to avoid leaking internal details
				connectErr := connect.NewError(connect.CodeInternal, fmt.Errorf("internal server error"))
				vs.writeConnectError(w, connectErr, serviceName, methodName)
			}
			return
		}

		// Write JSON response (will be transcoded to client's protocol by Vanguard)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(responseBody); err != nil {
			vs.logger.Error("failed to write response", zap.Error(err))
		}
	})
}

// writeConnectError writes a Connect error response in JSON format
// This ensures proper error formatting for the Connect protocol
func (vs *VanguardService) writeConnectError(w http.ResponseWriter, connectErr *connect.Error, serviceName, methodName string) {
	statusCode := ConnectCodeToHTTPStatus(connectErr.Code())

	vs.logger.Error("RPC handler error",
		zap.String("service", serviceName),
		zap.String("method", methodName),
		zap.String("connect_code", connectErr.Code().String()),
		zap.Int("http_status", statusCode),
		zap.String("error", connectErr.Message()))

	// Format error as Connect JSON error response
	// Connect protocol error format: {"code": "invalid_argument", "message": "error message"}
	errorResponse := map[string]any{
		"code":    connectErr.Code().String(),
		"message": connectErr.Message(),
	}

	// Check if this error contains GraphQL errors in metadata
	// If so, include them in a structured format for better error reporting
	if graphqlErrorsJSON := connectErr.Meta().Values(MetaKeyGraphQLErrors); len(graphqlErrorsJSON) > 0 {
		// Parse the GraphQL errors JSON from metadata
		var graphqlErrors []GraphQLError
		if err := json.Unmarshal([]byte(graphqlErrorsJSON[0]), &graphqlErrors); err == nil && len(graphqlErrors) > 0 {
			// Include GraphQL errors in the response for better debugging
			errorResponse["graphql_errors"] = graphqlErrors

			// If there are multiple GraphQL errors, update the message to indicate this
			if len(graphqlErrors) > 1 {
				errorResponse["message"] = fmt.Sprintf("%s (and %d more errors)", connectErr.Message(), len(graphqlErrors)-1)
			}
		}
	}

	// Add other metadata if present (excluding graphql_errors which we handled above)
	// Note: We don't add a "details" field here because Vanguard handles that internally

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		vs.logger.Error("failed to write error response", zap.Error(err))
	}
}

// extractMethodName extracts the method name from the request path
// Expected format: /package.Service/Method or package.Service/Method
func (vs *VanguardService) extractMethodName(path, serviceName string) string {
	// Remove leading slash if present
	path = strings.TrimPrefix(path, "/")

	// Expected format: package.Service/Method
	// Split by the service name
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		return ""
	}

	// Verify the service name matches
	if parts[0] != serviceName {
		return ""
	}

	return parts[1]
}

// GetServices returns all registered Vanguard services
func (vs *VanguardService) GetServices() []*vanguard.Service {
	return vs.services
}

// GetServiceCount returns the number of registered services
func (vs *VanguardService) GetServiceCount() int {
	return len(vs.services)
}

// GetServiceNames returns the names of all registered services
func (vs *VanguardService) GetServiceNames() []string {
	names := make([]string, 0, len(vs.services))
	for serviceName := range vs.protoLoader.GetServices() {
		names = append(names, serviceName)
	}
	return names
}

// ValidateService checks if a service exists
func (vs *VanguardService) ValidateService(serviceName string) error {
	if _, ok := vs.protoLoader.GetService(serviceName); !ok {
		return fmt.Errorf("service not found: %s", serviceName)
	}
	return nil
}

// ValidateMethod checks if a method exists in a service
func (vs *VanguardService) ValidateMethod(serviceName, methodName string) error {
	_, err := vs.protoLoader.GetMethod(serviceName, methodName)
	if err != nil {
		return fmt.Errorf("method not found: %w", err)
	}
	return nil
}

// GetMethodInfo returns information about a specific method
func (vs *VanguardService) GetMethodInfo(serviceName, methodName string) (*MethodDefinition, error) {
	method, err := vs.protoLoader.GetMethod(serviceName, methodName)
	if err != nil {
		return nil, fmt.Errorf("method not found: %w", err)
	}
	return method, nil
}

// GetServiceInfo returns information about a specific service
func (vs *VanguardService) GetServiceInfo(serviceName string) (*ServiceInfo, error) {
	serviceDef, ok := vs.protoLoader.GetService(serviceName)
	if !ok {
		return nil, fmt.Errorf("service not found: %s", serviceName)
	}

	info := &ServiceInfo{
		FullName:    serviceName,
		ServiceName: serviceDef.ServiceName,
		Methods:     make([]string, 0, len(serviceDef.Methods)),
	}

	for _, method := range serviceDef.Methods {
		info.Methods = append(info.Methods, method.Name)
	}

	return info, nil
}

// GetFileDescriptors returns all unique file descriptors from the proto loader
func (vs *VanguardService) GetFileDescriptors() []protoreflect.FileDescriptor {
	descriptors := make([]protoreflect.FileDescriptor, 0)
	seen := make(map[string]bool)

	for _, service := range vs.protoLoader.GetServices() {
		path := service.FileDescriptor.Path()
		if !seen[path] {
			seen[path] = true
			descriptors = append(descriptors, service.FileDescriptor)
		}
	}
	return descriptors
}

// ServiceInfo contains metadata about a service
type ServiceInfo struct {
	FullName    string   `json:"fullName"`
	ServiceName string   `json:"serviceName"`
	Methods     []string `json:"methods"`
}
