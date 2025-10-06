package connect_rpc

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
)

// ProtoManager handles proto file discovery and service method mapping
type ProtoManager struct {
	protoDir string
	services map[string]*ServiceInfo
	logger   *zap.Logger
}

// ServiceInfo represents a proto service with its methods
type ServiceInfo struct {
	Package     string
	ServiceName string
	Methods     []MethodInfo
}

// MethodInfo represents a proto service method
type MethodInfo struct {
	Name       string
	InputType  string
	OutputType string
}

// NewProtoManager creates a new proto manager
func NewProtoManager(protoDir string, logger *zap.Logger) *ProtoManager {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &ProtoManager{
		protoDir: protoDir,
		services: make(map[string]*ServiceInfo),
		logger:   logger,
	}
}

// LoadProtoFiles loads and parses proto files from the configured directory
func (pm *ProtoManager) LoadProtoFiles() error {
	if pm.protoDir == "" {
		return fmt.Errorf("proto directory not configured")
	}

	// Check if directory exists
	if _, err := os.Stat(pm.protoDir); os.IsNotExist(err) {
		pm.logger.Warn("Proto directory does not exist", zap.String("dir", pm.protoDir))
		return nil // Not an error, just no proto files to load
	}

	// Walk through the directory and process proto files
	err := filepath.WalkDir(pm.protoDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Only process proto files
		if !isProtoFile(path) {
			return nil
		}

		// Parse the proto file (simplified parsing for now)
		if err := pm.parseProtoFile(path); err != nil {
			pm.logger.Error("Failed to parse proto file", zap.String("file", path), zap.Error(err))
			return nil // Continue processing other files
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("error walking proto directory %s: %w", pm.protoDir, err)
	}

	pm.logger.Info("Loaded proto files", zap.Int("services", len(pm.services)))
	return nil
}

// GetServiceInfo returns service information for a given service path
func (pm *ProtoManager) GetServiceInfo(servicePath string) (*ServiceInfo, error) {
	// Parse service path: /package.ServiceName/MethodName
	parts := strings.Split(strings.TrimPrefix(servicePath, "/"), "/")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid service path: %s", servicePath)
	}

	serviceFullName := parts[0] // e.g., "service.v1.EmployeeService"
	
	if service, exists := pm.services[serviceFullName]; exists {
		return service, nil
	}

	return nil, fmt.Errorf("service not found: %s", serviceFullName)
}

// ExtractMethodName extracts the method name from a service path
func (pm *ProtoManager) ExtractMethodName(servicePath string) (string, error) {
	// Parse service path: /package.ServiceName/MethodName
	parts := strings.Split(strings.TrimPrefix(servicePath, "/"), "/")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid service path: %s", servicePath)
	}

	return parts[1], nil // e.g., "GetEmployeeByID"
}

// isProtoFile checks if a file is a proto file based on its extension
func isProtoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".proto"
}

// parseProtoFile performs simplified proto file parsing
// In a production implementation, you might want to use a proper proto parser
func (pm *ProtoManager) parseProtoFile(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read proto file %s: %w", path, err)
	}

	// Simple parsing - look for package and service declarations
	lines := strings.Split(string(content), "\n")
	var currentPackage string
	var currentService *ServiceInfo
	var braceDepth int
	var inService bool

	for lineNum, line := range lines {
		line = strings.TrimSpace(line)
		
		// Parse package declaration
		if strings.HasPrefix(line, "package ") {
			packageLine := strings.TrimPrefix(line, "package ")
			currentPackage = strings.TrimSuffix(packageLine, ";")
			pm.logger.Debug("Found package", zap.String("package", currentPackage))
			continue
		}

		// Parse service declaration
		if strings.HasPrefix(line, "service ") {
			serviceLine := strings.TrimPrefix(line, "service ")
			serviceName := strings.Fields(serviceLine)[0]
			
			currentService = &ServiceInfo{
				Package:     currentPackage,
				ServiceName: serviceName,
				Methods:     []MethodInfo{},
			}
			inService = true
			braceDepth = 0
			pm.logger.Debug("Found service", zap.String("service", serviceName))
			continue
		}

		if inService && currentService != nil {
			// Count braces to track nesting depth
			openBraces := strings.Count(line, "{")
			closeBraces := strings.Count(line, "}")
			braceDepth += openBraces - closeBraces

			// Parse RPC methods within service
			if strings.Contains(line, "rpc ") {
				method := pm.parseRPCMethod(line)
				if method != nil {
					currentService.Methods = append(currentService.Methods, *method)
					pm.logger.Debug("Parsed RPC method",
						zap.String("service", currentService.ServiceName),
						zap.String("method", method.Name),
						zap.String("input", method.InputType),
						zap.String("output", method.OutputType),
						zap.Int("line", lineNum+1))
				}
			}

			// End of service block - only when brace depth returns to -1 (closing the service)
			if braceDepth < 0 {
				serviceKey := fmt.Sprintf("%s.%s", currentPackage, currentService.ServiceName)
				pm.services[serviceKey] = currentService
				pm.logger.Info("Completed parsing proto service",
					zap.String("service", serviceKey),
					zap.Int("methods_found", len(currentService.Methods)))
				currentService = nil
				inService = false
				braceDepth = 0
			}
		}
	}

	return nil
}

// parseRPCMethod parses an RPC method line
func (pm *ProtoManager) parseRPCMethod(line string) *MethodInfo {
	// Example: "rpc GetEmployeeByID(GetEmployeeByIDRequest) returns (GetEmployeeByIDResponse);"
	// Or: "rpc GetEmployeeByID(GetEmployeeByIDRequest) returns (GetEmployeeByIDResponse) {"
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "rpc ") {
		return nil
	}

	// Remove "rpc " prefix and clean up
	line = strings.TrimPrefix(line, "rpc ")
	line = strings.TrimSuffix(line, ";")
	line = strings.TrimSuffix(line, "{") // Handle multi-line RPC blocks
	line = strings.TrimSpace(line)

	// Find method name (everything before the first parenthesis)
	parenIndex := strings.Index(line, "(")
	if parenIndex == -1 {
		pm.logger.Debug("No opening parenthesis found in RPC line", zap.String("line", line))
		return nil
	}

	methodName := strings.TrimSpace(line[:parenIndex])

	// Extract input and output types (simplified parsing)
	remainder := line[parenIndex:]
	
	// Find input type between first parentheses
	inputStart := strings.Index(remainder, "(")
	inputEnd := strings.Index(remainder, ")")
	if inputStart == -1 || inputEnd == -1 {
		pm.logger.Debug("Could not find input type parentheses", zap.String("remainder", remainder))
		return nil
	}
	
	inputType := strings.TrimSpace(remainder[inputStart+1 : inputEnd])

	// Find output type between "returns" parentheses
	returnsIndex := strings.Index(remainder, "returns")
	if returnsIndex == -1 {
		pm.logger.Debug("No 'returns' keyword found", zap.String("remainder", remainder))
		return nil
	}
	
	returnsRemainder := remainder[returnsIndex+7:] // Skip "returns"
	outputStart := strings.Index(returnsRemainder, "(")
	outputEnd := strings.Index(returnsRemainder, ")")
	if outputStart == -1 || outputEnd == -1 {
		pm.logger.Debug("Could not find output type parentheses", zap.String("returnsRemainder", returnsRemainder))
		return nil
	}
	
	outputType := strings.TrimSpace(returnsRemainder[outputStart+1 : outputEnd])

	pm.logger.Debug("Successfully parsed RPC method",
		zap.String("method", methodName),
		zap.String("input", inputType),
		zap.String("output", outputType))

	return &MethodInfo{
		Name:       methodName,
		InputType:  inputType,
		OutputType: outputType,
	}
}