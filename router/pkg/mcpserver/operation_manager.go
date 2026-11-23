package mcpserver

import (
	"fmt"

	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// OperationsManager handles the loading and preparation of GraphQL operations
type OperationsManager struct {
	schemaDoc        *ast.Document
	operations       []schemaloader.Operation
	logger           *zap.Logger
	excludeMutations bool
	fromManifest     bool
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

	om.fromManifest = false
	return om.setOperations(operations)
}

// LoadOperationsFromManifest loads MCP operations using the names in their documents.
func (om *OperationsManager) LoadOperationsFromManifest(manifestOperations map[string]string) error {
	loader := schemaloader.NewOperationLoader(om.logger, om.schemaDoc)
	operations, err := loader.LoadOperationsFromManifest(manifestOperations)
	if err != nil {
		return err
	}
	om.fromManifest = true
	return om.setOperations(operations)
}

// setOperations builds the input schemas for the candidate operations.
func (om *OperationsManager) setOperations(operations []schemaloader.Operation) error {
	builder := schemaloader.NewSchemaBuilder(om.schemaDoc)
	var err error
	om.operations, err = om.keep(operations, "Skipping MCP operation because its input schema cannot be built", builder.BuildSchemaForOperation)
	return err
}

// keep rejects a manifest on preparation failure; directory operations are logged
// and skipped. Excluded manifest mutations do not need preparation.
func (om *OperationsManager) keep(operations []schemaloader.Operation, msg string, fn func(*schemaloader.Operation) error) ([]schemaloader.Operation, error) {
	kept := operations[:0]
	for i := range operations {
		if om.fromManifest && om.excludeMutations && operations[i].OperationType == "mutation" {
			kept = append(kept, operations[i])
			continue
		}
		if err := fn(&operations[i]); err != nil {
			if om.fromManifest {
				return nil, fmt.Errorf("operation %q: %w", operations[i].Name, err)
			}
			om.logger.Error(msg, zap.String("operation", operations[i].Name), zap.Error(err))
			continue
		}
		kept = append(kept, operations[i])
	}
	clear(operations[len(kept):])
	return kept, nil
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

// ComputeToolScopes runs the scope extractor against all loaded operations,
// populating each operation's RequiredScopes from @requiresScopes directives.
// Manifest candidates fail as a whole; directory operations retain their
// log-and-skip behavior.
func (om *OperationsManager) ComputeToolScopes(fieldConfigs []*nodev1.FieldConfiguration, maxScopeCombinations int) error {
	extractor := NewScopeExtractor(fieldConfigs, om.schemaDoc, maxScopeCombinations)
	var err error
	om.operations, err = om.keep(om.operations, "Skipping MCP operation because its scopes cannot be computed", func(op *schemaloader.Operation) error {
		fieldReqs, err := extractor.ExtractScopesForOperation(&op.Document)
		if err != nil {
			return err
		}
		op.RequiredScopes, err = extractor.ComputeCombinedScopes(fieldReqs)
		return err
	})
	return err
}

// GetSchema returns the schema document used by the operations manager
func (om *OperationsManager) GetSchema() *ast.Document {
	return om.schemaDoc
}
