package schemaloader

import (
	"fmt"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/jsonschema"
)

// SchemaBuilder builds JSON schema from GraphQL operations
type SchemaBuilder struct {
	schemaDoc *ast.Document
}

// NewSchemaBuilder creates a new SchemaBuilder with the given schema document
func NewSchemaBuilder(schemaDoc *ast.Document) *SchemaBuilder {
	return &SchemaBuilder{
		schemaDoc: schemaDoc,
	}
}

// BuildSchemasForOperations builds JSON schemas for all input objects used in operations
// and adds the schema information directly to the operations
func (b *SchemaBuilder) BuildSchemasForOperations(operations []Operation) error {
	for i := range operations {
		// Build schema for this operation
		err := b.buildSchemaForOperation(&operations[i])
		if err != nil {
			return fmt.Errorf("failed to build schema for operation %s: %w", operations[i].Name, err)
		}
	}

	return nil
}

// buildSchemaForOperation builds JSON schema for input objects in a single operation
func (b *SchemaBuilder) buildSchemaForOperation(operation *Operation) error {
	schema, err := jsonschema.BuildJsonSchema(&operation.Document, b.schemaDoc)
	if err != nil {
		return fmt.Errorf("failed to build JSON schema: %w", err)
	}

	if schema != nil {
		s, err := schema.MarshalJSON()
		if err != nil {
			return fmt.Errorf("failed to marshal schema: %w", err)
		}
		operation.JSONSchema = s
		operation.Description = schema.Description
	}

	return nil
}
