package schemaloader

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/jsonschema-go/jsonschema"

	internaljsonschema "github.com/wundergraph/cosmo/router/internal/jsonschema"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// SchemaBuilder builds JSON schema from GraphQL operations
type SchemaBuilder struct {
	schemaDoc     *ast.Document
	scalarSchemas map[string]*jsonschema.Schema
	// defaultedScalars accumulates, across every operation built so far, the
	// custom scalar names that fell back to the default "string" schema.
	defaultedScalars map[string]bool
}

// SchemaBuilderOption configures a SchemaBuilder.
type SchemaBuilderOption func(*SchemaBuilder)

// WithScalarSchemas overrides the JSON schema emitted per custom scalar type
// name in generated operation schemas. Unmapped custom scalars default to
// "string" and are reported via DefaultedScalars. Each override must set Type
// (a single JSON type name), never Types.
func WithScalarSchemas(schemas map[string]*jsonschema.Schema) SchemaBuilderOption {
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
	builder := internaljsonschema.NewVariablesSchemaBuilder(&operation.Document, b.schemaDoc,
		internaljsonschema.WithScalarSchemas(b.scalarSchemas))
	schema, err := builder.Build()
	if err != nil {
		return fmt.Errorf("failed to build JSON schema: %w", err)
	}
	for _, name := range builder.DefaultedScalars() {
		b.defaultedScalars[name] = true
	}

	if schema != nil {
		s, err := json.Marshal(schema)
		if err != nil {
			return fmt.Errorf("failed to marshal schema: %w", err)
		}
		s, err = canonicalJSON(s)
		if err != nil {
			return fmt.Errorf("failed to canonicalize schema: %w", err)
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

// canonicalJSON re-encodes JSON with object keys sorted. The schema bytes are
// exposed verbatim in MCP tool output, which must stay byte-stable regardless
// of the schema marshaler's field order. Canonical bytes also insulate the persisted
// schema layout from changes in the library's struct field order across upgrades, so
// keep this even if the tests that forced it change.
func canonicalJSON(data []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber() // preserve number literals exactly
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
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
