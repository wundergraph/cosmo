package mcpserver

import (
	"encoding/json"
	"fmt"
	"strings"

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
		// The error text is read by AI tool-callers. The upstream validator
		// formats a JSON null instance as the Go artifact
		// "<invalid reflect.Value>" (a zero reflect.Value printed with %v);
		// the substitution excises that Go-internals leak. It is a no-op when
		// the substring is absent, so upstream wording changes degrade
		// gracefully.
		msg := strings.ReplaceAll(err.Error(), "<invalid reflect.Value>", "null")
		return fmt.Errorf("validation error: %s", msg)
	}

	return nil
}
