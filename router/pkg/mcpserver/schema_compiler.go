package mcpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"go.uber.org/zap"
)

// SchemaCompiler handles JSON schema compilation and validation
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

// CompileJSONSchema compiles a JSON schema from raw bytes
func (sc *SchemaCompiler) CompileJSONSchema(jsonSchema []byte, schemaName string) (*jsonschema.Schema, error) {
	if len(jsonSchema) == 0 {
		return nil, nil
	}

	c := jsonschema.NewCompiler()

	// Load the JSON schema from the bytes
	schema, err := jsonschema.UnmarshalJSON(bytes.NewReader(jsonSchema))
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON schema: %w", err)
	}

	if schemaName == "" {
		schemaName = "schema.json"
	}

	err = c.AddResource(schemaName, schema)
	if err != nil {
		return nil, fmt.Errorf("failed to add resource to JSON schema compiler: %w", err)
	}

	sch, err := c.Compile(schemaName)
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

// ValidateJSONSchema validates that the provided bytes are a valid JSON schema
func (sc *SchemaCompiler) ValidateJSONSchema(jsonSchema []byte) error {
	if len(jsonSchema) == 0 {
		return nil
	}

	// Attempt to compile the schema to verify it's valid
	_, err := sc.CompileJSONSchema(jsonSchema, "")
	return err
}
