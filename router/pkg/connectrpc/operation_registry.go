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
// It loads operations from a directory and provides lookup by operation name.
// Operations are cached in memory for fast access during request handling.
type OperationRegistry struct {
	operations map[string]*schemaloader.Operation
	mu         sync.RWMutex
	logger     *zap.Logger
}

// NewOperationRegistry creates a new operation registry.
func NewOperationRegistry(logger *zap.Logger) *OperationRegistry {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &OperationRegistry{
		operations: make(map[string]*schemaloader.Operation),
		logger:     logger,
	}
}

// LoadFromDirectory loads all GraphQL operations from the specified directory.
// Operations are validated against the provided schema and cached in memory.
// This method is thread-safe and can be called multiple times to reload operations.
func (r *OperationRegistry) LoadFromDirectory(operationsDir string, schemaDoc *ast.Document) error {
	if operationsDir == "" {
		return fmt.Errorf("operations directory cannot be empty")
	}

	if schemaDoc == nil {
		return fmt.Errorf("schema document cannot be nil")
	}

	// Load operations using the schema loader
	loader := schemaloader.NewOperationLoader(r.logger, schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(operationsDir)
	if err != nil {
		return fmt.Errorf("failed to load operations from directory %s: %w", operationsDir, err)
	}

	// Build JSON schemas for operations
	builder := schemaloader.NewSchemaBuilder(schemaDoc)
	err = builder.BuildSchemasForOperations(operations)
	if err != nil {
		return fmt.Errorf("failed to build schemas for operations: %w", err)
	}

	// Update the registry with loaded operations
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clear existing operations
	r.operations = make(map[string]*schemaloader.Operation)

	// Add new operations to the registry
	for i := range operations {
		op := &operations[i]
		r.operations[op.Name] = op
		r.logger.Debug("Loaded operation",
			zap.String("name", op.Name),
			zap.String("type", op.OperationType),
			zap.String("file", op.FilePath))
	}

	r.logger.Info("Loaded operations into registry",
		zap.Int("count", len(r.operations)),
		zap.String("directory", operationsDir))

	return nil
}

// LoadFromDirectoryWithoutSchema loads GraphQL operations from a directory without schema validation.
// This is a simpler version that just reads the .graphql files and extracts operation names.
// Operations are treated as templates that will be executed against the GraphQL endpoint.
func (r *OperationRegistry) LoadFromDirectoryWithoutSchema(operationsDir string) error {
	if operationsDir == "" {
		return fmt.Errorf("operations directory cannot be empty")
	}

	r.logger.Info("Loading operations from directory without schema validation",
		zap.String("directory", operationsDir))

	operations, err := r.loadOperationsSimple(operationsDir)
	if err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	// Update the registry with loaded operations
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clear existing operations
	r.operations = make(map[string]*schemaloader.Operation)

	// Add new operations to the registry
	for i := range operations {
		op := &operations[i]
		r.operations[op.Name] = op
		r.logger.Debug("Loaded operation",
			zap.String("name", op.Name),
			zap.String("type", op.OperationType),
			zap.String("file", op.FilePath))
	}

	r.logger.Info("Loaded operations into registry",
		zap.Int("count", len(r.operations)),
		zap.String("directory", operationsDir))

	return nil
}

// loadOperationsSimple loads operations from files without schema validation
func (r *OperationRegistry) loadOperationsSimple(dirPath string) ([]schemaloader.Operation, error) {
	var operations []schemaloader.Operation
	
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory %s: %w", dirPath, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		// Only process .graphql and .gql files
		name := entry.Name()
		if !strings.HasSuffix(name, ".graphql") && !strings.HasSuffix(name, ".gql") {
			continue
		}

		filePath := filepath.Join(dirPath, name)
		content, err := os.ReadFile(filePath)
		if err != nil {
			r.logger.Warn("Failed to read operation file",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		operationString := string(content)
		
		// Parse just to extract the operation name and type
		opDoc, report := astparser.ParseGraphqlDocumentString(operationString)
		if report.HasErrors() {
			r.logger.Warn("Failed to parse operation file",
				zap.String("file", filePath),
				zap.String("error", report.Error()))
			continue
		}

		// Extract operation name and type
		opName, opType, err := r.extractOperationInfo(&opDoc)
		if err != nil {
			r.logger.Warn("Failed to extract operation info",
				zap.String("file", filePath),
				zap.Error(err))
			continue
		}

		// If no operation name, use filename without extension
		if opName == "" {
			opName = strings.TrimSuffix(name, filepath.Ext(name))
		}

		operations = append(operations, schemaloader.Operation{
			Name:            opName,
			FilePath:        filePath,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
		})
	}

	return operations, nil
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

// GetOperation retrieves an operation by name.
// Returns nil if the operation is not found.
// This method is thread-safe.
func (r *OperationRegistry) GetOperation(name string) *schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.operations[name]
}

// HasOperation checks if an operation with the given name exists in the registry.
// This method is thread-safe.
func (r *OperationRegistry) HasOperation(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	_, exists := r.operations[name]
	return exists
}

// GetAllOperations returns a slice of all operations in the registry.
// The returned slice is a copy to prevent external modification.
// This method is thread-safe.
func (r *OperationRegistry) GetAllOperations() []schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	operations := make([]schemaloader.Operation, 0, len(r.operations))
	for _, op := range r.operations {
		operations = append(operations, *op)
	}

	return operations
}

// Count returns the number of operations in the registry.
// This method is thread-safe.
func (r *OperationRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.operations)
}

// AddOperation adds a single operation to the registry.
// This method is thread-safe and is used by Dynamic Mode to cache generated operations.
func (r *OperationRegistry) AddOperation(op *schemaloader.Operation) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.operations[op.Name] = op
	r.logger.Debug("Added operation to registry",
		zap.String("name", op.Name),
		zap.String("type", op.OperationType))
}

// Clear removes all operations from the registry.
// This method is thread-safe.
func (r *OperationRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.operations = make(map[string]*schemaloader.Operation)
	r.logger.Debug("Cleared operation registry")
}