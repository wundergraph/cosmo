package connectrpc

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/linker"
	"github.com/bufbuild/protocompile/reporter"
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
	InputMessageDescriptor protoreflect.MessageDescriptor
	// OutputMessageDescriptor is the descriptor for the output message
	OutputMessageDescriptor protoreflect.MessageDescriptor
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
	// processedFiles tracks which file descriptors we've already processed for service extraction
	// Key is the file path to ensure uniqueness across different directories
	processedFiles map[string]bool
}

// NewProtoLoader creates a new proto loader
func NewProtoLoader(logger *zap.Logger) *ProtoLoader {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &ProtoLoader{
		logger:         logger,
		services:       make(map[string]*ServiceDefinition),
		files:          &protoregistry.Files{},
		processedFiles: make(map[string]bool),
	}
}

// LoadFromDirectory loads all .proto files from a directory
func (pl *ProtoLoader) LoadFromDirectory(dir string) error {
	pl.logger.Debug("loading proto files from directory", zap.String("dir", dir))

	// Find all .proto files
	protoFiles, err := pl.findProtoFiles(dir)
	if err != nil {
		return fmt.Errorf("failed to find proto files: %w", err)
	}

	if len(protoFiles) == 0 {
		return fmt.Errorf("no proto files found in directory: %s", dir)
	}

	pl.logger.Debug("found proto files", zap.Int("count", len(protoFiles)))

	// Compute relative paths for all proto files
	relativeFiles := make([]string, 0, len(protoFiles))
	for _, protoFile := range protoFiles {
		relPath, err := filepath.Rel(dir, protoFile)
		if err != nil {
			return fmt.Errorf("failed to compute relative path for %s: %w", protoFile, err)
		}
		relativeFiles = append(relativeFiles, relPath)
	}

	// Parse all files in a single batch with the root directory as import path
	// This allows imports to resolve correctly across the entire tree
	if err := pl.parseProtoFiles(dir, relativeFiles); err != nil {
		return fmt.Errorf("failed to parse proto files: %w", err)
	}

	pl.logger.Debug("successfully loaded proto files",
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

		// Track service names before loading to identify new ones
		existingServices := make(map[string]bool)
		for serviceName := range pl.services {
			existingServices[serviceName] = true
		}

		// Compute relative paths for all proto files in this directory
		relativeFiles := make([]string, 0, len(protoFiles))
		for _, protoFile := range protoFiles {
			relPath, err := filepath.Rel(dir, protoFile)
			if err != nil {
				return fmt.Errorf("failed to compute relative path for %s: %w", protoFile, err)
			}
			relativeFiles = append(relativeFiles, relPath)
		}

		// Parse all files from this directory in a single batch
		// Use the directory as the import path so imports resolve correctly
		if err := pl.parseProtoFiles(dir, relativeFiles); err != nil {
			pl.logger.Error("failed to parse proto files",
				zap.String("dir", dir),
				zap.Error(err))
			return fmt.Errorf("failed to parse proto files from %s: %w", dir, err)
		}

		// Validate package uniqueness for newly added services
		for serviceName, service := range pl.services {
			// Only check services that were just added in this batch
			if existingServices[serviceName] {
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

// parseProtoFiles parses multiple proto files in a single batch using the root directory
// as the import path. This allows imports to resolve correctly across the entire tree.
func (pl *ProtoLoader) parseProtoFiles(rootDir string, relativeFilenames []string) error {
	pl.logger.Debug("parsing proto files in batch",
		zap.String("root_dir", rootDir),
		zap.Int("file_count", len(relativeFilenames)))

	// Create a source resolver with the root directory as import path
	sourceResolver := &protocompile.SourceResolver{
		ImportPaths: []string{rootDir},
	}

	// Wrap with standard imports to provide access to well-known proto files
	// like google/protobuf/descriptor.proto, google/protobuf/wrappers.proto, etc.
	resolverWithStandardImports := protocompile.WithStandardImports(sourceResolver)

	// Create a compiler with the resolver that includes standard imports
	compiler := protocompile.Compiler{
		Resolver: resolverWithStandardImports,
		// Use a custom reporter to capture errors and warnings
		Reporter: reporter.NewReporter(
			func(err reporter.ErrorWithPos) error {
				pl.logger.Error("proto compilation error",
					zap.String("file", err.GetPosition().Filename),
					zap.Int("line", err.GetPosition().Line),
					zap.Int("col", err.GetPosition().Col),
					zap.String("error", err.Unwrap().Error()))
				return err
			},
			func(err reporter.ErrorWithPos) {
				pl.logger.Warn("proto compilation warning",
					zap.String("file", err.GetPosition().Filename),
					zap.Int("line", err.GetPosition().Line),
					zap.Int("col", err.GetPosition().Col),
					zap.String("warning", err.Unwrap().Error()))
			},
		),
		// Include source code info for better error messages
		SourceInfoMode: protocompile.SourceInfoStandard,
	}

	// Compile all files in a single batch
	ctx := context.Background()
	results, err := compiler.Compile(ctx, relativeFilenames...)
	if err != nil {
		return fmt.Errorf("failed to compile proto files: %w", err)
	}

	// Process each file descriptor
	for _, result := range results {
		if err := pl.processFileDescriptor(result); err != nil {
			return fmt.Errorf("failed to process file descriptor: %w", err)
		}
	}

	return nil
}

// processFileDescriptor extracts service definitions from a file descriptor
func (pl *ProtoLoader) processFileDescriptor(result linker.File) error {
	// linker.File implements protoreflect.FileDescriptor interface
	fd := protoreflect.FileDescriptor(result)
	filePath := fd.Path()

	// Check if we've already processed this file for service extraction
	if pl.processedFiles[string(filePath)] {
		pl.logger.Debug("file descriptor already processed for service extraction, skipping",
			zap.String("file", string(filePath)))
		return nil
	}

	// Mark this file as processed
	pl.processedFiles[filePath] = true

	// Try to register the file descriptor in our local registry
	_, err := pl.files.FindFileByPath(filePath)
	if err == nil {
		// File path already registered
		pl.logger.Debug("file path already registered in local registry, skipping registration",
			zap.String("file", filePath))
	} else {
		// Register the file descriptor in our LOCAL registry (not global)
		if err := pl.files.RegisterFile(fd); err != nil {
			pl.logger.Error("file descriptor registration failed in local registry",
				zap.String("file", filePath),
				zap.Error(err))
			return fmt.Errorf("failed to register file descriptor in local registry: %w", err)
		}

		pl.logger.Debug("file descriptor registered successfully in local registry",
			zap.String("file", filePath))
	}

	// Extract services from this file descriptor
	services := fd.Services()
	for i := 0; i < services.Len(); i++ {
		service := services.Get(i)
		serviceDef := pl.extractServiceDefinition(fd, service)

		pl.services[serviceDef.FullName] = serviceDef

		pl.logger.Debug("extracted service",
			zap.String("service", serviceDef.FullName),
			zap.Int("methods", len(serviceDef.Methods)))
	}

	return nil
}

// extractServiceDefinition extracts a service definition from a service descriptor
func (pl *ProtoLoader) extractServiceDefinition(fd protoreflect.FileDescriptor, service protoreflect.ServiceDescriptor) *ServiceDefinition {
	serviceDef := &ServiceDefinition{
		FullName:          string(service.FullName()),
		Package:           string(fd.Package()),
		ServiceName:       string(service.Name()),
		FileDescriptor:    fd,
		ServiceDescriptor: service,
		Methods:           make([]MethodDefinition, 0),
	}

	// Extract methods
	methods := service.Methods()
	for i := 0; i < methods.Len(); i++ {
		method := methods.Get(i)
		methodDef := MethodDefinition{
			Name:                    string(method.Name()),
			FullName:                string(method.FullName()),
			InputType:               string(method.Input().FullName()),
			OutputType:              string(method.Output().FullName()),
			InputMessageDescriptor:  method.Input(),
			OutputMessageDescriptor: method.Output(),
			IsClientStreaming:       method.IsStreamingClient(),
			IsServerStreaming:       method.IsStreamingServer(),
		}
		serviceDef.Methods = append(serviceDef.Methods, methodDef)
	}

	return serviceDef
}

// GetServices returns all loaded service definitions.
// The returned map should be treated as read-only to prevent accidental mutation.
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

// getFieldByJSONName finds a field in a message descriptor by its JSON name (camelCase).
// Protobuf JSON uses camelCase field names, but descriptors store the original proto field names.
// This function tries to match by JSON name first, then falls back to the original name.
func getFieldByJSONName(msg protoreflect.MessageDescriptor, jsonName string) protoreflect.FieldDescriptor {
	if msg == nil {
		return nil
	}
	fields := msg.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		// Check if JSON name matches (protobuf automatically generates JSON names)
		if field.JSONName() == jsonName {
			return field
		}
		// Fallback: check if the original field name matches
		if string(field.Name()) == jsonName {
			return field
		}
	}
	return nil
}

// getEnumType returns the enum descriptor for a field, or nil if not an enum
func getEnumType(field protoreflect.FieldDescriptor) protoreflect.EnumDescriptor {
	if field.Kind() == protoreflect.EnumKind {
		return field.Enum()
	}
	return nil
}

// getMessageType returns the message descriptor for a field, or nil if not a message
func getMessageType(field protoreflect.FieldDescriptor) protoreflect.MessageDescriptor {
	if field.Kind() == protoreflect.MessageKind {
		return field.Message()
	}
	return nil
}
