package mcpserver

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// OperationsManager handles the loading and preparation of GraphQL operations
type OperationsManager struct {
	schemaDoc        *ast.Document
	operations       []schemaloader.Operation
	logger           *zap.Logger
	excludeMutations bool
}

// NewOperationsManager creates a new operations manager
func NewOperationsManager(schemaDoc *ast.Document, logger *zap.Logger, excludeMutations bool) *OperationsManager {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &OperationsManager{
		schemaDoc:        schemaDoc,
		logger:           logger,
		excludeMutations: excludeMutations,
	}
}

// LoadOperationsFromDirectory loads operations from a specified directory
func (om *OperationsManager) LoadOperationsFromDirectory(operationsDir string) error {
	// Load operations
	loader := schemaloader.NewOperationLoader(om.logger, om.schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(operationsDir)
	if err != nil {
		return fmt.Errorf("failed to load operations: %w", err)
	}

	// Build schemas for operations
	builder := schemaloader.NewSchemaBuilder(om.schemaDoc)
	err = builder.BuildSchemasForOperations(operations)
	if err != nil {
		return fmt.Errorf("failed to build schemas: %w", err)
	}

	om.operations = operations

	return nil
}

// GetOperations returns all loaded operations
func (om *OperationsManager) GetOperations() []schemaloader.Operation {
	return om.operations
}

// GetFilteredOperations returns operations filtered by excludeMutations setting
func (om *OperationsManager) GetFilteredOperations() []schemaloader.Operation {
	if !om.excludeMutations {
		return om.operations
	}

	filteredOps := make([]schemaloader.Operation, 0, len(om.operations))
	for _, op := range om.operations {
		if op.OperationType != "mutation" {
			filteredOps = append(filteredOps, op)
		}
	}
	return filteredOps
}

// GetOperation gets a specific operation by name
func (om *OperationsManager) GetOperation(name string) *schemaloader.Operation {
	for i := range om.operations {
		if om.operations[i].Name == name {
			if om.operations[i].OperationType == "mutation" && om.excludeMutations {
				return nil // Mutation excluded by configuration
			}
			return &om.operations[i]
		}
	}
	return nil
}

// GetSchema returns the schema document used by the operations manager
func (om *OperationsManager) GetSchema() *ast.Document {
	return om.schemaDoc
}
