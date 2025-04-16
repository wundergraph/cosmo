package mcpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"go.uber.org/zap"
)

// SchemaCompiler handles JSON schema compilation for operations
type SchemaCompiler struct {
	logger *zap.Logger
}

// NewSchemaCompiler creates a new schema compiler with the given logger
func NewSchemaCompiler(logger *zap.Logger) *SchemaCompiler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &SchemaCompiler{
		logger: logger,
	}
}

// CompileSchema compiles a JSON schema for a single operation
func (sc *SchemaCompiler) CompileSchema(op schemaloader.Operation) (*jsonschema.Schema, error) {
	if len(op.JSONSchema) == 0 {
		return nil, nil
	}

	c := jsonschema.NewCompiler()

	// Load the JSON schema from the operation
	schema, err := jsonschema.UnmarshalJSON(bytes.NewReader(op.JSONSchema))
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON schema: %w", err)
	}

	sn := fmt.Sprintf("schema-%s.json", op.Name)
	err = c.AddResource(sn, schema)
	if err != nil {
		return nil, fmt.Errorf("failed to add resource to JSON schema compiler: %w", err)
	}

	sch, err := c.Compile(sn)
	if err != nil {
		return nil, fmt.Errorf("failed to compile JSON schema: %w", err)
	}

	return sch, nil
}

// ValidateInput validates input data against a compiled schema
func (sc *SchemaCompiler) ValidateInput(data []byte, compiledSchema *jsonschema.Schema) error {
	if compiledSchema == nil {
		return nil
	}

	var v interface{}
	if err := json.Unmarshal(data, &v); err != nil {
		return fmt.Errorf("failed to parse JSON input: %w", err)
	}

	if err := compiledSchema.Validate(v); err != nil {
		var validationErr *jsonschema.ValidationError
		if errors.As(err, &validationErr) {
			return fmt.Errorf("validation error: %s", validationErr.Causes[0].Error())
		}
		return fmt.Errorf("schema validation failed: %w", err)
	}

	return nil
}
