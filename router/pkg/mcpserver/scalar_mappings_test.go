package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/jsonschema"
)

func TestScalarMappingsTranslateToSchemas(t *testing.T) {
	t.Run("valid mappings translate to typed schemas", func(t *testing.T) {
		schemas, err := scalarSchemasFromMappings(map[string]string{
			"JSON":   "object",
			"BigInt": "integer",
		})
		require.NoError(t, err)
		assert.Equal(t, map[string]*jsonschema.JsonSchema{
			"JSON":   {Type: jsonschema.TypeObject},
			"BigInt": {Type: jsonschema.TypeInteger},
		}, schemas)
	})

	t.Run("unknown JSON schema type returns an error naming the scalar and the value", func(t *testing.T) {
		schemas, err := scalarSchemasFromMappings(map[string]string{
			"JSON": "blob",
		})
		require.Error(t, err)
		assert.Nil(t, schemas)
		assert.ErrorContains(t, err, `scalar "JSON"`)
		assert.ErrorContains(t, err, `"blob"`)
	})

	t.Run("empty and nil mappings translate to nil", func(t *testing.T) {
		schemas, err := scalarSchemasFromMappings(nil)
		require.NoError(t, err)
		assert.Nil(t, schemas)

		schemas, err = scalarSchemasFromMappings(map[string]string{})
		require.NoError(t, err)
		assert.Nil(t, schemas)
	})
}
