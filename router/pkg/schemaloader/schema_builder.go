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

// BuildSchemaForOperation builds JSON schema for input objects in a single operation
func (b *SchemaBuilder) BuildSchemaForOperation(operation *Operation) error {
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

		// Use operation description if provided, otherwise fall back to schema description
		// This ensures user-provided descriptions take absolute priority
		if operation.Description == "" {
			operation.Description = schema.Description
		}
		// If operation.Description is not empty, keep it as-is (don't merge with schema description)
	}

	return nil
}
