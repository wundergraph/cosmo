package connectrpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

// OperationRegistry manages pre-defined GraphQL operations for ConnectRPC.
// Operations are scoped to their service (package.service) and cached in memory
// for fast access during request handling.
type OperationRegistry struct {
	// Service-scoped operations: serviceName (package.service) -> operationName -> Operation
	operations map[string]map[string]*schemaloader.Operation
	mu         sync.RWMutex
	logger     *zap.Logger
}

// NewOperationRegistry creates a new operation registry.
func NewOperationRegistry(logger *zap.Logger) *OperationRegistry {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &OperationRegistry{
		operations: make(map[string]map[string]*schemaloader.Operation),
		logger:     logger,
	}
}

// LoadOperationsForService loads GraphQL operations for a specific service from operation files.
// Operations are scoped to the service's fully qualified name (package.service).
// This method is thread-safe and can be called multiple times for different services.
func (r *OperationRegistry) LoadOperationsForService(serviceName string, operationFiles []string) error {
	if serviceName == "" {
		return fmt.Errorf("service name cannot be empty")
	}

	r.logger.Info("loading operations for service",
		zap.String("service", serviceName),
		zap.Int("file_count", len(operationFiles)))

	r.mu.Lock()
	defer r.mu.Unlock()

	// Initialize service map if needed
	if r.operations[serviceName] == nil {
		r.operations[serviceName] = make(map[string]*schemaloader.Operation)
	}

	// Track operation names to detect duplicates within this service
	seenOperations := make(map[string]string) // operation name -> file path

	// Load each operation file
	for _, filePath := range operationFiles {
		content, err := os.ReadFile(filePath)
		if err != nil {
			r.logger.Warn("failed to read operation file",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		operationString := string(content)

		// Parse to extract operation name and type
		opDoc, report := astparser.ParseGraphqlDocumentString(operationString)
		if report.HasErrors() {
			r.logger.Warn("failed to parse operation file",
				zap.String("file", filePath),
				zap.String("error", report.Error()))
			continue
		}

		// Extract operation name and type
		opName, opType, err := r.extractOperationInfo(&opDoc)
		if err != nil {
			r.logger.Warn("failed to extract operation info",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		// If no operation name, use filename without extension
		if opName == "" {
			opName = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
		}

		// Check for duplicate operation names within this service
		if existingFile, exists := seenOperations[opName]; exists {
			r.logger.Warn("duplicate operation name within service, last one wins",
				zap.String("service", serviceName),
				zap.String("operation", opName),
				zap.String("previous_file", existingFile),
				zap.String("current_file", filePath))
		}

		operation := &schemaloader.Operation{
			Name:            opName,
			FilePath:        filePath,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
		}

		r.operations[serviceName][opName] = operation
		seenOperations[opName] = filePath

		r.logger.Debug("loaded operation for service",
			zap.String("service", serviceName),
			zap.String("operation", opName),
			zap.String("type", opType),
			zap.String("file", filePath))
	}

	r.logger.Info("loaded operations for service",
		zap.String("service", serviceName),
		zap.Int("operation_count", len(r.operations[serviceName])))

	return nil
}

// extractOperationInfo extracts the name and type from an operation document
func (r *OperationRegistry) extractOperationInfo(doc *ast.Document) (string, string, error) {
	for _, ref := range doc.RootNodes {
		if ref.Kind == ast.NodeKindOperationDefinition {
			opDef := doc.OperationDefinitions[ref.Ref]
			
			opType := ""
			switch opDef.OperationType {
			case ast.OperationTypeQuery:
				opType = "query"
			case ast.OperationTypeMutation:
				opType = "mutation"
			case ast.OperationTypeSubscription:
				opType = "subscription"
			default:
				return "", "", fmt.Errorf("unknown operation type")
			}

			opName := ""
			if opDef.Name.Length() > 0 {
				opName = string(doc.Input.ByteSlice(opDef.Name))
			}
			
			return opName, opType, nil
		}
	}
	return "", "", fmt.Errorf("no operation found in document")
}

// GetOperationForService retrieves an operation for a specific service.
// Returns nil if the service or operation is not found.
// This method is thread-safe.
func (r *OperationRegistry) GetOperationForService(serviceName, operationName string) *schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return nil
	}

	return serviceOps[operationName]
}

// HasOperationForService checks if an operation exists for a specific service.
// This method is thread-safe.
func (r *OperationRegistry) HasOperationForService(serviceName, operationName string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return false
	}

	_, exists = serviceOps[operationName]
	return exists
}

// GetAllOperationsForService returns all operations for a specific service.
// The returned slice is a copy to prevent external modification.
// Returns an empty slice if the service doesn't exist.
// This method is thread-safe.
func (r *OperationRegistry) GetAllOperationsForService(serviceName string) []schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return []schemaloader.Operation{}
	}

	operations := make([]schemaloader.Operation, 0, len(serviceOps))
	for _, op := range serviceOps {
		operations = append(operations, *op)
	}

	return operations
}

// GetAllOperations returns all operations across all services.
// The returned slice is a copy to prevent external modification.
// This method is thread-safe.
func (r *OperationRegistry) GetAllOperations() []schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var operations []schemaloader.Operation
	for _, serviceOps := range r.operations {
		for _, op := range serviceOps {
			operations = append(operations, *op)
		}
	}

	return operations
}

// Count returns the total number of operations across all services.
// This method is thread-safe.
func (r *OperationRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	count := 0
	for _, serviceOps := range r.operations {
		count += len(serviceOps)
	}
	return count
}

// CountForService returns the number of operations for a specific service.
// This method is thread-safe.
func (r *OperationRegistry) CountForService(serviceName string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return 0
	}

	return len(serviceOps)
}

// GetServiceNames returns all service names that have operations registered.
// This method is thread-safe.
func (r *OperationRegistry) GetServiceNames() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	names := make([]string, 0, len(r.operations))
	for serviceName := range r.operations {
		names = append(names, serviceName)
	}

	return names
}

// Clear removes all operations from the registry.
// This method is thread-safe.
func (r *OperationRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.operations = make(map[string]map[string]*schemaloader.Operation)
	r.logger.Debug("cleared operation registry")
}

// ClearService removes all operations for a specific service.
// This method is thread-safe.
func (r *OperationRegistry) ClearService(serviceName string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.operations, serviceName)
	r.logger.Debug("cleared operations for service",
		zap.String("service", serviceName))
}