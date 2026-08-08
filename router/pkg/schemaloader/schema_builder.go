package schemaloader

import (
	"fmt"
	"sort"

	"github.com/wundergraph/cosmo/router/internal/jsonschema"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// SchemaBuilder builds JSON schema from GraphQL operations
type SchemaBuilder struct {
	schemaDoc     *ast.Document
	scalarSchemas map[string]*jsonschema.JsonSchema
	// defaultedScalars accumulates, across every operation built so far, the
	// custom scalar names that fell back to the default "string" schema.
	defaultedScalars map[string]bool
}

// SchemaBuilderOption configures a SchemaBuilder.
type SchemaBuilderOption func(*SchemaBuilder)

// WithScalarSchemas overrides the JSON schema emitted per custom scalar type
// name in generated operation schemas. Unmapped custom scalars default to
// "string" and are reported via DefaultedScalars.
func WithScalarSchemas(schemas map[string]*jsonschema.JsonSchema) SchemaBuilderOption {
	return func(b *SchemaBuilder) {
		b.scalarSchemas = schemas
	}
}

// NewSchemaBuilder creates a new SchemaBuilder with the given schema document
func NewSchemaBuilder(schemaDoc *ast.Document, opts ...SchemaBuilderOption) *SchemaBuilder {
	b := &SchemaBuilder{
		schemaDoc:        schemaDoc,
		defaultedScalars: make(map[string]bool),
	}

	for _, opt := range opts {
		opt(b)
	}

	return b
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
	builder := jsonschema.NewVariablesSchemaBuilder(&operation.Document, b.schemaDoc,
		jsonschema.WithScalarSchemas(b.scalarSchemas))
	schema, err := builder.Build()
	if err != nil {
		return fmt.Errorf("failed to build JSON schema: %w", err)
	}
	for _, name := range builder.DefaultedScalars() {
		b.defaultedScalars[name] = true
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

// DefaultedScalars returns the sorted names of custom scalars that fell back
// to the default "string" schema across all operations built so far.
func (b *SchemaBuilder) DefaultedScalars() []string {
	names := make([]string, 0, len(b.defaultedScalars))
	for name := range b.defaultedScalars {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
