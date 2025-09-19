package connect_rpc

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

// Collection represents a set of named operations
type Collection struct {
	logger     *zap.Logger
	operations map[string]schemaloader.Operation
}

func NewCollection(logger *zap.Logger) *Collection {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &Collection{
		logger: logger,
	}
}

// LoadFromDirectory loads operations from a specified directory
func (c *Collection) LoadFromDirectory(collectionDir string) error {

	collection := make(map[string]schemaloader.Operation)

	err := filepath.WalkDir(collectionDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".graphql") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		doc, report := astparser.ParseGraphqlDocumentBytes(content)
		if report.HasErrors() {
			return fmt.Errorf("failed to parse %s: %s", path, report.Error())
		}

		for _, ref := range doc.RootNodes {
			if ref.Kind != ast.NodeKindOperationDefinition {
				continue
			}

			opDef := doc.OperationDefinitions[ref.Ref]

			// Skip anonymous operations - we need named operations for Connect RPC
			if opDef.Name.Length() == 0 {
				return fmt.Errorf("%s contains an anonymous operation; Connect RPC requires named operations", path)
			}

			operationName := doc.Input.ByteSliceString(opDef.Name)

			// Check for duplicate operation names
			if _, exists := collection[operationName]; exists {
				return fmt.Errorf("duplicate operation name %q found in %s", operationName, path)
			}

			// Determine operation type
			var opType string
			switch opDef.OperationType {
			case ast.OperationTypeQuery:
				opType = "query"
			case ast.OperationTypeMutation:
				opType = "mutation"
			case ast.OperationTypeSubscription:
				opType = "subscription"
			default:
				opType = "unknown"
			}

			// Store the operation with pre-computed variables and schema
			collection[operationName] = schemaloader.Operation{
				Name:            operationName,
				FilePath:        path,
				Document:        doc,
				OperationString: string(content),
				OperationType:   opType,
			}
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to load operations from %s: %w", collectionDir, err)
	}

	if len(collection) == 0 {
		return fmt.Errorf("no GraphQL operations found in %s", collectionDir)
	}

	c.operations = collection

	return nil
}
