package connectrpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
)

// DiscoveredService represents a service found during directory scanning
type DiscoveredService struct {
	// ServiceDir is the directory containing the service's proto and operation files
	ServiceDir string
	// ProtoFiles are the proto files found in this service directory
	ProtoFiles []string
	// OperationFiles are the GraphQL operation files found recursively in this service directory
	OperationFiles []string
	// Package is the proto package name extracted from proto files
	Package string
	// ServiceName is the service name extracted from proto files
	ServiceName string
	// FullName is the fully qualified service name (package.service)
	FullName string
}

// ServiceDiscoveryConfig holds configuration for service discovery
type ServiceDiscoveryConfig struct {
	// ServicesDir is the root directory containing all service subdirectories
	ServicesDir string
	// Logger for structured logging
	Logger *zap.Logger
}

// DiscoverServices scans a services directory and discovers all services based on convention.
// It looks for subdirectories containing .proto files and returns information about each service.
//
// Directory structure can be:
// - Flat: services/employee.v1/*.proto
// - Nested: services/company/employee.v1/*.proto
//
// Each service directory must contain at least one .proto file.
// All .proto files in a service directory must declare the same package.
// The service name is extracted from the proto files, not the directory name.
func DiscoverServices(config ServiceDiscoveryConfig) ([]DiscoveredService, error) {
	if config.ServicesDir == "" {
		return nil, fmt.Errorf("services directory cannot be empty")
	}

	if config.Logger == nil {
		config.Logger = zap.NewNop()
	}

	config.Logger.Debug("discovering services",
		zap.String("services_dir", config.ServicesDir))

	// Check if services directory exists
	if _, err := os.Stat(config.ServicesDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("services directory does not exist: %s", config.ServicesDir)
	}

	var discoveredServices []DiscoveredService
	seenPackageService := make(map[string]string) // "package.service" -> directory

	// Walk the services directory to find all directories (including root) with proto files
	err := filepath.Walk(config.ServicesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Only process directories (including the root services directory)
		if !info.IsDir() {
			return nil
		}

		// Check if this directory contains proto files
		protoFiles, err := findProtoFilesInDir(path)
		if err != nil {
			return fmt.Errorf("failed to find proto files in %s: %w", path, err)
		}

		// Skip directories without proto files - continue searching subdirectories
		if len(protoFiles) == 0 {
			return nil
		}

		config.Logger.Debug("found directory with proto files",
			zap.String("dir", path),
			zap.Int("proto_count", len(protoFiles)))

		// Extract package and service information from proto files
		packageName, serviceName, err := extractServiceInfo(protoFiles, config.Logger)
		if err != nil {
			return fmt.Errorf("failed to extract service info from %s: %w", path, err)
		}

		fullName := fmt.Sprintf("%s.%s", packageName, serviceName)

		// Validate package.service uniqueness
		if existingDir, exists := seenPackageService[fullName]; exists {
			return fmt.Errorf(
				"duplicate service '%s' found in multiple directories: '%s' and '%s'. "+
					"Each package.service combination must be unique",
				fullName, existingDir, path)
		}
		seenPackageService[fullName] = path

		// Find all operation files recursively in this service directory
		operationFiles, err := findOperationFiles(path)
		if err != nil {
			config.Logger.Warn("failed to find operation files",
				zap.String("dir", path),
				zap.Error(err))
			operationFiles = []string{} // Continue even if no operations found
		}

		discoveredServices = append(discoveredServices, DiscoveredService{
			ServiceDir:     path,
			ProtoFiles:     protoFiles,
			OperationFiles: operationFiles,
			Package:        packageName,
			ServiceName:    serviceName,
			FullName:       fullName,
		})

		config.Logger.Info("discovered service",
			zap.String("full_name", fullName),
			zap.String("package", packageName),
			zap.String("service", serviceName),
			zap.String("dir", path),
			zap.Int("proto_files", len(protoFiles)),
			zap.Int("operation_files", len(operationFiles)))

		// Don't descend into subdirectories of a service directory
		// This prevents finding the same service multiple times
		return filepath.SkipDir
	})

	if err != nil {
		return nil, fmt.Errorf("failed to discover services: %w", err)
	}

	if len(discoveredServices) == 0 {
		return nil, fmt.Errorf("no services found in directory: %s", config.ServicesDir)
	}

	config.Logger.Info("service discovery complete",
		zap.Int("total_services", len(discoveredServices)),
		zap.String("services_dir", config.ServicesDir))

	return discoveredServices, nil
}

// findProtoFilesInDir finds all .proto files directly in a directory (non-recursive)
func findProtoFilesInDir(dir string) ([]string, error) {
	var protoFiles []string

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if strings.HasSuffix(entry.Name(), ".proto") {
			protoFiles = append(protoFiles, filepath.Join(dir, entry.Name()))
		}
	}

	return protoFiles, nil
}

// extractServiceInfo extracts package and service name from proto files.
// Only one proto file is expected per directory.
// Returns the package name and service name.
func extractServiceInfo(protoFiles []string, logger *zap.Logger) (string, string, error) {
	if len(protoFiles) == 0 {
		return "", "", fmt.Errorf("no proto files provided")
	}

	// Enforce one proto file per directory
	if len(protoFiles) > 1 {
		return "", "", fmt.Errorf(
			"only one proto file is allowed per directory, found %d proto files. "+
				"Each service should have its own directory with a single proto file",
			len(protoFiles))
	}

	protoFile := protoFiles[0]
	content, err := os.ReadFile(protoFile)
	if err != nil {
		return "", "", fmt.Errorf("failed to read proto file %s: %w", protoFile, err)
	}

	// Extract package name
	packageName := extractPackageFromProto(string(content))
	if packageName == "" {
		return "", "", fmt.Errorf("no package declaration found in %s", protoFile)
	}

	// Extract service name
	serviceName := extractServiceNameFromProto(string(content))
	if serviceName == "" {
		return "", "", fmt.Errorf("no service declaration found in %s", protoFile)
	}

	logger.Debug("extracted service info from proto",
		zap.String("file", protoFile),
		zap.String("package", packageName),
		zap.String("service", serviceName))

	return packageName, serviceName, nil
}

// extractPackageFromProto extracts the package name from proto file content
func extractPackageFromProto(content string) string {
	lines := strings.SplitSeq(content, "\n")
	for line := range lines {
		line = strings.TrimSpace(line)
		if after, ok := strings.CutPrefix(line, "package "); ok {
			// Extract package name: "package foo.bar;" -> "foo.bar"
			pkg := after
			pkg = strings.TrimSuffix(pkg, ";")
			pkg = strings.TrimSpace(pkg)
			return pkg
		}
	}
	return ""
}

// extractServiceNameFromProto extracts the first service name from proto file content
func extractServiceNameFromProto(content string) string {
	lines := strings.SplitSeq(content, "\n")
	for line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "service ") {
			// Extract service name: "service MyService {" -> "MyService"
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				serviceName := parts[1]
				// Remove trailing { if present
				serviceName = strings.TrimSuffix(serviceName, "{")
				serviceName = strings.TrimSpace(serviceName)
				return serviceName
			}
		}
	}
	return ""
}

// findOperationFiles finds all .graphql files in a directory and its subdirectories
func findOperationFiles(dir string) ([]string, error) {
	var operationFiles []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && (strings.HasSuffix(path, ".graphql") || strings.HasSuffix(path, ".gql")) {
			operationFiles = append(operationFiles, path)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return operationFiles, nil
}
