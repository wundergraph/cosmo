package connect_rpc

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bufbuild/protocompile"
	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// ProtoLoader handles loading and parsing proto files
type ProtoLoader struct {
	logger   *zap.Logger
	services []protoreflect.ServiceDescriptor
	files    []protoreflect.FileDescriptor
}

// NewProtoLoader creates a new proto loader and loads the specified proto files
func NewProtoLoader(protoFiles []string, logger *zap.Logger) (*ProtoLoader, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	if len(protoFiles) == 0 {
		return nil, fmt.Errorf("at least one proto file is required")
	}

	loader := &ProtoLoader{
		logger:   logger,
		services: make([]protoreflect.ServiceDescriptor, 0),
		files:    make([]protoreflect.FileDescriptor, 0),
	}

	logger.Info("Loading proto files", zap.Int("count", len(protoFiles)))

	// Compile proto files
	if err := loader.compileProtoFiles(protoFiles); err != nil {
		return nil, fmt.Errorf("failed to compile proto files: %w", err)
	}

	logger.Info("Loaded proto services", zap.Int("services", len(loader.services)))

	return loader, nil
}

// NewProtoLoaderFromDir creates a new proto loader and loads all .proto files from a directory
func NewProtoLoaderFromDir(protoDir string, logger *zap.Logger) (*ProtoLoader, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	if protoDir == "" {
		return nil, fmt.Errorf("proto directory is required")
	}

	// Find all .proto files in the directory
	protoFiles, err := findProtoFiles(protoDir)
	if err != nil {
		return nil, fmt.Errorf("failed to find proto files in directory %s: %w", protoDir, err)
	}

	if len(protoFiles) == 0 {
		return nil, fmt.Errorf("no .proto files found in directory: %s", protoDir)
	}

	logger.Info("Found proto files in directory", 
		zap.String("directory", protoDir),
		zap.Int("count", len(protoFiles)),
		zap.Strings("files", protoFiles))

	// Use the existing NewProtoLoader function
	return NewProtoLoader(protoFiles, logger)
}

// findProtoFiles recursively finds all .proto files in a directory
func findProtoFiles(dir string) ([]string, error) {
	var protoFiles []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".proto") {
			protoFiles = append(protoFiles, path)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return protoFiles, nil
}



// compileProtoFiles compiles proto files using protocompile
func (p *ProtoLoader) compileProtoFiles(protoFiles []string) error {
	// Extract import paths from proto file directories and make paths relative
	importPaths := make(map[string]bool)
	relativeFiles := make([]string, 0, len(protoFiles))

	for _, file := range protoFiles {
		absPath, err := filepath.Abs(file)
		if err != nil {
			return fmt.Errorf("failed to get absolute path for %s: %w", file, err)
		}
		dir := filepath.Dir(absPath)
		importPaths[dir] = true
		// Use just the filename for compilation
		relativeFiles = append(relativeFiles, filepath.Base(absPath))
	}

	// Add router's proto directory for gnostic annotations and other common imports
	// Try multiple possible locations for the router proto directory
	possibleRouterProtoDirs := []string{
		"router/proto",
		"../router/proto", 
		"../../router/proto",
		filepath.Join(filepath.Dir(os.Args[0]), "router/proto"),
	}
	
	for _, dir := range possibleRouterProtoDirs {
		routerProtoDir, err := filepath.Abs(dir)
		if err == nil {
			if _, err := os.Stat(routerProtoDir); err == nil {
				importPaths[routerProtoDir] = true
				p.logger.Debug("Added router proto directory to import paths", zap.String("path", routerProtoDir))
				break
			}
		}
	}

	// Convert map to slice
	importPathSlice := make([]string, 0, len(importPaths))
	for path := range importPaths {
		importPathSlice = append(importPathSlice, path)
	}

	// Create a compiler with the proto directories as import paths
	compiler := protocompile.Compiler{
		Resolver: &protocompile.SourceResolver{
			ImportPaths: importPathSlice,
		},
	}

	// Compile all proto files using relative names
	ctx := context.Background()
	compiled, err := compiler.Compile(ctx, relativeFiles...)
	if err != nil {
		return fmt.Errorf("failed to compile proto files: %w", err)
	}

	// Extract service descriptors from compiled files
	for _, fileDesc := range compiled {
		p.files = append(p.files, fileDesc)

		services := fileDesc.Services()
		for i := 0; i < services.Len(); i++ {
			service := services.Get(i)
			p.services = append(p.services, service)

			// Log service details at INFO level for visibility
			methods := service.Methods()
			methodNames := make([]string, methods.Len())
			for j := 0; j < methods.Len(); j++ {
				methodNames[j] = string(methods.Get(j).Name())
			}
			
			p.logger.Info("Loaded proto service",
				zap.String("service", string(service.FullName())),
				zap.Int("method_count", methods.Len()),
				zap.Strings("methods", methodNames))
		}
	}

	return nil
}

// GetServices returns all loaded service descriptors
func (p *ProtoLoader) GetServices() []protoreflect.ServiceDescriptor {
	return p.services
}

// GetFiles returns all loaded file descriptors
func (p *ProtoLoader) GetFiles() []protoreflect.FileDescriptor {
	return p.files
}

// GetServiceByName finds a service descriptor by its full name
func (p *ProtoLoader) GetServiceByName(name string) (protoreflect.ServiceDescriptor, error) {
	for _, service := range p.services {
		if string(service.FullName()) == name {
			return service, nil
		}
	}
	return nil, fmt.Errorf("service not found: %s", name)
}

// GetMethodDescriptor finds a method descriptor by service and method name
func (p *ProtoLoader) GetMethodDescriptor(serviceName, methodName string) (protoreflect.MethodDescriptor, error) {
	service, err := p.GetServiceByName(serviceName)
	if err != nil {
		return nil, err
	}

	methods := service.Methods()
	for i := 0; i < methods.Len(); i++ {
		method := methods.Get(i)
		if string(method.Name()) == methodName {
			return method, nil
		}
	}

	return nil, fmt.Errorf("method not found: %s.%s", serviceName, methodName)
}
