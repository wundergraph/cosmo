package mcpserver

import (
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
)

// allowedScalarMappingTypes are the JSON schema type names an mcp.scalar_mappings
// entry may map a custom scalar to.
var allowedScalarMappingTypes = map[string]bool{
	"string":  true,
	"integer": true,
	"number":  true,
	"boolean": true,
	"object":  true,
	"array":   true,
}

// scalarSchemasFromMappings translates config scalar mappings (scalar name ->
// JSON schema type name) into schema overrides.
// YAML config is enum-checked by the config JSON schema, but env-sourced
// config (MCP_SCALAR_MAPPINGS) bypasses schema validation entirely - this
// runtime check is the only guard on that path.
func scalarSchemasFromMappings(mappings map[string]string) (map[string]*jsonschema.Schema, error) {
	if len(mappings) == 0 {
		return nil, nil
	}
	schemas := make(map[string]*jsonschema.Schema, len(mappings))
	for scalar, typeName := range mappings {
		if !allowedScalarMappingTypes[typeName] {
			return nil, fmt.Errorf("invalid scalar mapping for scalar %q: %q is not a JSON schema type (allowed: string, integer, number, boolean, object, array)", scalar, typeName)
		}
		schemas[scalar] = &jsonschema.Schema{Type: typeName}
	}
	return schemas, nil
}
