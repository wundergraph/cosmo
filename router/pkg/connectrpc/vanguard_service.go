package connectrpc

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"connectrpc.com/vanguard"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// VanguardServiceConfig holds configuration for creating a Vanguard service
type VanguardServiceConfig struct {
	Handler     *RPCHandler
	ProtoLoader *ProtoLoader
	Logger      *zap.Logger
}

// VanguardService wraps the RPC handler and creates Vanguard services
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

	vs.services = make([]*vanguard.Service, 0, len(protoServices))

	for serviceName, serviceDef := range protoServices {
		vs.logger.Info("registering service with vanguard",
			zap.String("service_name", serviceName),
			zap.String("full_name", serviceDef.FullName),
			zap.Int("method_count", len(serviceDef.Methods)))
		
		// Log all methods for this service
		for _, method := range serviceDef.Methods {
			vs.logger.Info("service method",
				zap.String("service", serviceName),
				zap.String("method", method.Name),
				zap.String("input_type", method.InputType),
				zap.String("output_type", method.OutputType))
		}
		
		// Create an HTTP handler for this service
		// The handler will receive requests at paths like: /Method (without the service prefix)
		serviceHandler := vs.createServiceHandler(serviceName, serviceDef)

		// Now that we've registered the file descriptor in the global registry,
		// we can use NewService instead of NewServiceWithSchema
		// The service path should be the fully qualified service name with slashes
		servicePath := "/" + serviceName + "/"
		
		vs.logger.Info("creating vanguard service",
			zap.String("service_path", servicePath))
		
		// Configure Vanguard to always transcode to Connect protocol with JSON codec
		// This ensures our handler always receives JSON, regardless of the incoming protocol
		vanguardService := vanguard.NewService(
			servicePath,
			serviceHandler,
			vanguard.WithTargetProtocols(vanguard.ProtocolConnect),
			vanguard.WithTargetCodecs("json"),
		)

		vs.services = append(vs.services, vanguardService)

		vs.logger.Info("registered Vanguard service successfully",
			zap.String("service", serviceName),
			zap.String("service_path", servicePath),
			zap.String("target_protocol", "connect"),
			zap.String("target_codec", "json"))
	}

	return nil
}

// createServiceHandler creates an HTTP handler for a specific proto service
func (vs *VanguardService) createServiceHandler(serviceName string, serviceDef *ServiceDefinition) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract method name from path: /employee.v1.EmployeeService/QueryGetEmployees
		path := strings.TrimPrefix(r.URL.Path, "/")
		parts := strings.Split(path, "/")
		
		var methodName string
		if len(parts) == 2 {
			methodName = parts[1]
		} else if len(parts) == 1 {
			methodName = parts[0]
		} else {
			http.Error(w, "invalid path format", http.StatusNotFound)
			return
		}
		
		// Validate method exists
		methodExists := false
		for _, method := range serviceDef.Methods {
			if method.Name == methodName {
				methodExists = true
				break
			}
		}
		
		if !methodExists {
			http.Error(w, fmt.Sprintf("method not found: %s", methodName), http.StatusNotFound)
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
			// Read request body (JSON from Vanguard transcoder for POST requests)
			requestBody, err = io.ReadAll(r.Body)
			if err != nil {
				vs.logger.Error("failed to read request body", zap.Error(err))
				http.Error(w, "failed to read request", http.StatusBadRequest)
				return
			}
		}

		// Add headers to context for forwarding to GraphQL
		ctx := withRequestHeaders(r.Context(), r.Header)

		// Handle the RPC request
		responseBody, err := vs.handler.HandleRPC(ctx, serviceName, methodName, requestBody)
		if err != nil {
			vs.logger.Error("RPC handler error",
				zap.String("service", serviceName),
				zap.String("method", methodName),
				zap.Error(err))
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Write JSON response (Vanguard will transcode to client's protocol)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(responseBody); err != nil {
			vs.logger.Error("failed to write response", zap.Error(err))
		}
	})
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

// GetFileDescriptors returns all file descriptors from the proto loader
func (vs *VanguardService) GetFileDescriptors() []protoreflect.FileDescriptor {
	descriptors := make([]protoreflect.FileDescriptor, 0)
	for _, service := range vs.protoLoader.GetServices() {
		descriptors = append(descriptors, service.FileDescriptor)
	}
	return descriptors
}

// ServiceInfo contains metadata about a service
type ServiceInfo struct {
	FullName    string   `json:"fullName"`
	ServiceName string   `json:"serviceName"`
	Methods     []string `json:"methods"`
}