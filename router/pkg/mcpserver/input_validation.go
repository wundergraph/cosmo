package mcpserver

import (
	"encoding/json"
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
)

// resolveSchema prepares an operation's built variables schema for input
// validation. A nil schema resolves to nil: operations without input skip
// validation. A schema that fails to resolve is a registration error; the
// caller must not register the tool.
func resolveSchema(schema *jsonschema.Schema) (*jsonschema.Resolved, error) {
	if schema == nil {
		return nil, nil
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve JSON schema: %w", err)
	}
	return resolved, nil
}

// validateInput validates raw JSON tool arguments against a resolved schema.
// A nil resolved schema validates nothing.
func validateInput(data []byte, resolved *jsonschema.Resolved) error {
	if resolved == nil {
		return nil
	}

	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return fmt.Errorf("failed to parse JSON input: %w", err)
	}

	if err := resolved.Validate(v); err != nil {
		return fmt.Errorf("validation error: %s", err)
	}

	return nil
}
