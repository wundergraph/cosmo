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

	for serviceName := range protoServices {
		// Create an HTTP handler for this service
		serviceHandler := vs.createServiceHandler(serviceName)

		// Create a Vanguard service
		// The service name should be the fully qualified proto service name
		vanguardService := vanguard.NewService(serviceName, serviceHandler)

		vs.services = append(vs.services, vanguardService)

		vs.logger.Debug("registered Vanguard service",
			zap.String("service", serviceName))
	}

	return nil
}

// createServiceHandler creates an HTTP handler for a specific proto service
func (vs *VanguardService) createServiceHandler(serviceName string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract method name from the request path
		// Vanguard sends requests to paths like: /package.Service/Method
		methodName := vs.extractMethodName(r.URL.Path, serviceName)
		if methodName == "" {
			http.Error(w, "invalid method path", http.StatusNotFound)
			return
		}

		// Read the request body (JSON from Vanguard)
		requestBody, err := io.ReadAll(r.Body)
		if err != nil {
			vs.logger.Error("failed to read request body", zap.Error(err))
			http.Error(w, "failed to read request", http.StatusBadRequest)
			return
		}

		// Add headers to context for forwarding
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

		// Write the response
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