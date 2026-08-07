package mcpserver

import (
	"fmt"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/jsonschema"
)

// allowedScalarMappingTypes are the JSON schema type names an mcp.scalar_mappings
// entry may map a custom scalar to.
var allowedScalarMappingTypes = map[string]jsonschema.SchemaType{
	"string":  jsonschema.TypeString,
	"integer": jsonschema.TypeInteger,
	"number":  jsonschema.TypeNumber,
	"boolean": jsonschema.TypeBoolean,
	"object":  jsonschema.TypeObject,
	"array":   jsonschema.TypeArray,
}

// scalarSchemasFromMappings translates config scalar mappings (scalar name ->
// JSON schema type name) into schema overrides. The config JSON schema already
// restricts values via enum; this guards programmatic callers.
func scalarSchemasFromMappings(mappings map[string]string) (map[string]*jsonschema.JsonSchema, error) {
	if len(mappings) == 0 {
		return nil, nil
	}
	schemas := make(map[string]*jsonschema.JsonSchema, len(mappings))
	for scalar, typeName := range mappings {
		schemaType, ok := allowedScalarMappingTypes[typeName]
		if !ok {
			return nil, fmt.Errorf("invalid scalar mapping for scalar %q: %q is not a JSON schema type (allowed: string, integer, number, boolean, object, array)", scalar, typeName)
		}
		schemas[scalar] = &jsonschema.JsonSchema{Type: schemaType}
	}
	return schemas, nil
}
