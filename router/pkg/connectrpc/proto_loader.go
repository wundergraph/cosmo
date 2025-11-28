package connectrpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// ServiceDefinition represents a parsed protobuf service
type ServiceDefinition struct {
	// FullName is the fully qualified service name (e.g., "mypackage.MyService")
	FullName string
	// Package is the protobuf package name
	Package string
	// ServiceName is the simple service name
	ServiceName string
	// Methods contains all RPC methods in this service
	Methods []MethodDefinition
	// FileDescriptor is the proto file descriptor
	FileDescriptor protoreflect.FileDescriptor
	// ServiceDescriptor is the service descriptor
	ServiceDescriptor protoreflect.ServiceDescriptor
}

// MethodDefinition represents a parsed RPC method
type MethodDefinition struct {
	// Name is the method name (e.g., "GetUser")
	Name string
	// FullName is the fully qualified method name
	FullName string
	// InputType is the fully qualified input message type
	InputType string
	// OutputType is the fully qualified output message type
	OutputType string
	// InputMessageDescriptor is the descriptor for the input message
	InputMessageDescriptor *desc.MessageDescriptor
	// OutputMessageDescriptor is the descriptor for the output message
	OutputMessageDescriptor *desc.MessageDescriptor
	// IsClientStreaming indicates if this is a client streaming RPC
	IsClientStreaming bool
	// IsServerStreaming indicates if this is a server streaming RPC
	IsServerStreaming bool
}

// ProtoLoader handles loading and parsing of protobuf files
type ProtoLoader struct {
	logger *zap.Logger
	// services maps service full names to their definitions
	services map[string]*ServiceDefinition
	// files is a custom registry for file descriptors (avoids global registry)
	files *protoregistry.Files
}

// NewProtoLoader creates a new proto loader
func NewProtoLoader(logger *zap.Logger) *ProtoLoader {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &ProtoLoader{
		logger:   logger,
		services: make(map[string]*ServiceDefinition),
		files:    &protoregistry.Files{},
	}
}

// LoadFromDirectory loads all .proto files from a directory
func (pl *ProtoLoader) LoadFromDirectory(dir string) error {
	pl.logger.Info("loading proto files from directory", zap.String("dir", dir))

	// Find all .proto files
	protoFiles, err := pl.findProtoFiles(dir)
	if err != nil {
		return fmt.Errorf("failed to find proto files: %w", err)
	}

	if len(protoFiles) == 0 {
		return fmt.Errorf("no proto files found in directory: %s", dir)
	}

	pl.logger.Info("found proto files", zap.Int("count", len(protoFiles)))

	// Load each proto file
	for _, protoFile := range protoFiles {
		if err := pl.loadProtoFile(protoFile); err != nil {
			pl.logger.Error("failed to load proto file",
				zap.String("file", protoFile),
				zap.Error(err))
			return fmt.Errorf("failed to load proto file %s: %w", protoFile, err)
		}
	}

	pl.logger.Info("successfully loaded proto files",
		zap.Int("services", len(pl.services)))

	return nil
}

// LoadFromDirectories loads all .proto files from multiple directories
// and validates that proto package names are unique across all directories.
// The proto package name acts as a namespace, so duplicate packages are not allowed.
func (pl *ProtoLoader) LoadFromDirectories(dirs []string) error {
	if len(dirs) == 0 {
		return fmt.Errorf("no directories provided")
	}

	pl.logger.Info("loading proto files from multiple directories",
		zap.Int("directory_count", len(dirs)))

	// Track packages we've seen to enforce uniqueness
	seenPackages := make(map[string]string) // package name -> directory

	for _, dir := range dirs {
		pl.logger.Debug("loading proto files from directory", zap.String("dir", dir))

		// Find all .proto files in this directory
		protoFiles, err := pl.findProtoFiles(dir)
		if err != nil {
			return fmt.Errorf("failed to find proto files in %s: %w", dir, err)
		}

		if len(protoFiles) == 0 {
			pl.logger.Warn("no proto files found in directory", zap.String("dir", dir))
			continue
		}

		pl.logger.Debug("found proto files",
			zap.String("dir", dir),
			zap.Int("count", len(protoFiles)))

		// Load each proto file and track packages
		for _, protoFile := range protoFiles {
			// Get the current service count before loading
			serviceCountBefore := len(pl.services)

			if err := pl.loadProtoFile(protoFile); err != nil {
				pl.logger.Error("failed to load proto file",
					zap.String("file", protoFile),
					zap.String("dir", dir),
					zap.Error(err))
				return fmt.Errorf("failed to load proto file %s from %s: %w", protoFile, dir, err)
			}

			// Check for new services and validate package uniqueness
			for _, service := range pl.services {
				// Only check services that were just added
				if serviceCountBefore > 0 {
					// Skip if we've already validated this service
					continue
				}

				packageName := service.Package
				if existingDir, exists := seenPackages[packageName]; exists && existingDir != dir {
					return fmt.Errorf(
						"duplicate proto package '%s' found in multiple directories: '%s' and '%s'. "+
							"Proto package names must be unique across all services",
						packageName, existingDir, dir)
				}
				seenPackages[packageName] = dir

				pl.logger.Debug("registered proto package",
					zap.String("package", packageName),
					zap.String("dir", dir),
					zap.String("service", service.FullName))
			}
		}
	}

	pl.logger.Info("successfully loaded proto files from all directories",
		zap.Int("total_services", len(pl.services)),
		zap.Int("unique_packages", len(seenPackages)))

	return nil
}

// findProtoFiles recursively finds all .proto files in a directory
func (pl *ProtoLoader) findProtoFiles(dir string) ([]string, error) {
	var protoFiles []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(path, ".proto") {
			protoFiles = append(protoFiles, path)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return protoFiles, nil
}

// loadProtoFile loads and parses a single proto file using protoparse
func (pl *ProtoLoader) loadProtoFile(path string) error {
	pl.logger.Debug("loading proto file", zap.String("path", path))

	// Get the directory containing the proto file for import resolution
	dir := filepath.Dir(path)
	filename := filepath.Base(path)

	// Create a parser with the directory as import path
	parser := protoparse.Parser{
		ImportPaths:      []string{dir},
		IncludeSourceCodeInfo: true,
	}

	// Parse the proto file
	fds, err := parser.ParseFiles(filename)
	if err != nil {
		return fmt.Errorf("failed to parse proto file: %w", err)
	}

	// Process each file descriptor
	for _, fd := range fds {
		if err := pl.processFileDescriptor(fd); err != nil {
			return fmt.Errorf("failed to process file descriptor: %w", err)
		}
	}

	return nil
}

// processFileDescriptor extracts service definitions from a file descriptor
func (pl *ProtoLoader) processFileDescriptor(fd *desc.FileDescriptor) error {
	// Convert to protoreflect.FileDescriptor and register it globally
	// This is required for Vanguard to find the service schema
	protoFd := fd.UnwrapFile()
	
	// Check if the file is already registered to avoid panic
	_, err := protoregistry.GlobalFiles.FindFileByPath(string(protoFd.Path()))
	if err == nil {
		// File is already registered, skip registration
		pl.logger.Debug("file descriptor already registered, skipping",
			zap.String("file", string(protoFd.Path())))
	} else {
		// Register the file descriptor in the global registry
		// This is required for Vanguard's transcoder to find the service schema
		err := protoregistry.GlobalFiles.RegisterFile(protoFd)
		if err != nil {
			// Log but don't fail - the file might have been registered concurrently
			pl.logger.Debug("file descriptor registration failed (may already be registered)",
				zap.String("file", string(protoFd.Path())),
				zap.Error(err))
		} else {
			pl.logger.Debug("file descriptor registered successfully",
				zap.String("file", string(protoFd.Path())))
		}
	}
	
	// Extract services
	services := fd.GetServices()
	for _, service := range services {
		serviceDef := pl.extractServiceDefinition(service)
		
		pl.services[serviceDef.FullName] = serviceDef
		
		pl.logger.Debug("extracted service",
			zap.String("service", serviceDef.FullName),
			zap.Int("methods", len(serviceDef.Methods)))
	}

	return nil
}

// extractServiceDefinition extracts a service definition from a service descriptor
func (pl *ProtoLoader) extractServiceDefinition(service *desc.ServiceDescriptor) *ServiceDefinition {
	// Convert desc.FileDescriptor to protoreflect.FileDescriptor
	fd := service.GetFile().UnwrapFile()
	
	// Get the service descriptor from the file descriptor
	services := fd.Services()
	var serviceDesc protoreflect.ServiceDescriptor
	for i := 0; i < services.Len(); i++ {
		sd := services.Get(i)
		if string(sd.FullName()) == service.GetFullyQualifiedName() {
			serviceDesc = sd
			break
		}
	}

	serviceDef := &ServiceDefinition{
		FullName:          service.GetFullyQualifiedName(),
		Package:           service.GetFile().GetPackage(),
		ServiceName:       service.GetName(),
		FileDescriptor:    fd,
		ServiceDescriptor: serviceDesc,
		Methods:           make([]MethodDefinition, 0),
	}

	// Extract methods
	methods := service.GetMethods()
	for _, method := range methods {
		methodDef := MethodDefinition{
			Name:                    method.GetName(),
			FullName:                method.GetFullyQualifiedName(),
			InputType:               method.GetInputType().GetFullyQualifiedName(),
			OutputType:              method.GetOutputType().GetFullyQualifiedName(),
			InputMessageDescriptor:  method.GetInputType(),
			OutputMessageDescriptor: method.GetOutputType(),
			IsClientStreaming:       method.IsClientStreaming(),
			IsServerStreaming:       method.IsServerStreaming(),
		}
		serviceDef.Methods = append(serviceDef.Methods, methodDef)
	}

	return serviceDef
}

// GetServices returns all loaded service definitions
func (pl *ProtoLoader) GetServices() map[string]*ServiceDefinition {
	return pl.services
}

// GetService returns a specific service definition by full name
func (pl *ProtoLoader) GetService(fullName string) (*ServiceDefinition, bool) {
	service, ok := pl.services[fullName]
	return service, ok
}

// GetMethod finds a method by service and method name
func (pl *ProtoLoader) GetMethod(serviceName, methodName string) (*MethodDefinition, error) {
	service, ok := pl.services[serviceName]
	if !ok {
		return nil, fmt.Errorf("service not found: %s", serviceName)
	}

	for i := range service.Methods {
		if service.Methods[i].Name == methodName {
			return &service.Methods[i], nil
		}
	}

	return nil, fmt.Errorf("method not found: %s.%s", serviceName, methodName)
}

// GetFiles returns the custom Files registry containing all loaded file descriptors
// This is used to create a custom type resolver
func (pl *ProtoLoader) GetFiles() *protoregistry.Files {
	return pl.files
}