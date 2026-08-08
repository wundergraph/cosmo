package jsonschema

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJsonSchema_MarshalJSON(t *testing.T) {
	t.Run("object schema", func(t *testing.T) {
		// Create a complex nested schema
		schema := NewObjectSchema()
		schema.Description = "Test object schema"

		// Add string property with description and default
		stringProp := NewStringSchema()
		stringProp.Description = "A string property"
		stringProp.Default = "default value"
		schema.Properties["name"] = stringProp
		schema.Required = append(schema.Required, "name")

		// Add integer property with minimum
		intProp := NewIntegerSchema()
		min := float64(0)
		intProp.Minimum = &min
		schema.Properties["age"] = intProp
		schema.Required = append(schema.Required, "age")

		// Add enum property
		enumValues := []string{"ONE", "TWO", "THREE"}
		enumProp := NewEnumSchema(enumValues)
		schema.Properties["category"] = enumProp

		// Add nested object property
		nestedObj := NewObjectSchema()
		nestedObj.Properties["street"] = NewStringSchema()
		nestedObj.Properties["city"] = NewStringSchema()
		nestedObj.Required = append(nestedObj.Required, "street")
		schema.Properties["address"] = nestedObj

		// Add array property
		arrayProp := NewArraySchema(NewStringSchema())
		schema.Properties["tags"] = arrayProp

		// Serialize to JSON
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "description": "Test object schema",
  "properties": {
    "address": {
      "additionalProperties": false,
      "properties": {
        "city": {
          "type": [
            "string",
            "null"
          ]
        },
        "street": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "street"
      ],
      "type": [
        "object",
        "null"
      ]
    },
    "age": {
      "minimum": 0,
      "type": [
        "integer",
        "null"
      ]
    },
    "category": {
      "enum": [
        "ONE",
        "TWO",
        "THREE",
        null
      ],
      "type": [
        "string",
        "null"
      ]
    },
    "name": {
      "default": "default value",
      "description": "A string property",
      "type": [
        "string",
        "null"
      ]
    },
    "tags": {
      "items": {
        "type": [
          "string",
          "null"
        ]
      },
      "type": [
        "array",
        "null"
      ]
    }
  },
  "required": [
    "name",
    "age"
  ],
  "type": [
    "object",
    "null"
  ]
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("nested schema", func(t *testing.T) {
		// Create a schema with nested objects (previously would have used references)
		rootSchema := NewObjectSchema()
		rootSchema.Description = "Root schema"

		// Create a nested schema
		nestedSchema := NewObjectSchema()
		nestedSchema.Description = "Nested schema"
		nestedSchema.Properties["value"] = NewStringSchema()

		// Add the nested schema as a property
		rootSchema.Properties["nested"] = nestedSchema

		// Create an array of the nested schema
		arraySchema := NewArraySchema(nestedSchema)
		rootSchema.Properties["items"] = arraySchema

		// Serialize to JSON
		data, err := json.Marshal(rootSchema)
		require.NoError(t, err)

		// Parse it back to verify
		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		// Verify structure - there should be no $ref
		properties := parsed["properties"].(map[string]any)
		nestedProp := properties["nested"].(map[string]any)

		// Check that it's properly inlined; nullable schemas serialize "type" as
		// the JSON Schema 2020-12 two-element array [<type>, "null"].
		assert.Equal(t, []any{"object", "null"}, nestedProp["type"])
		assert.Equal(t, "Nested schema", nestedProp["description"])
		assert.Contains(t, nestedProp, "properties")

		// Check the array contains the same schema inline
		itemsProp := properties["items"].(map[string]any)
		assert.Equal(t, []any{"array", "null"}, itemsProp["type"])
		assert.Contains(t, itemsProp, "items")

		itemsSchema := itemsProp["items"].(map[string]any)
		assert.Equal(t, []any{"object", "null"}, itemsSchema["type"])
		assert.Equal(t, "Nested schema", itemsSchema["description"])
	})
}

func TestSchemaFeatures(t *testing.T) {
	t.Run("enum schema", func(t *testing.T) {
		// Test creating and validating enum schema
		values := []string{"RED", "GREEN", "BLUE"}
		schema := NewEnumSchema(values)

		// Test serialization
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "enum": [
    "RED",
    "GREEN",
    "BLUE",
    null
  ],
  "type": [
    "string",
    "null"
  ]
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("required fields", func(t *testing.T) {
		// Create schema with required fields
		schema := NewObjectSchema()
		schema.Properties["id"] = NewStringSchema()
		schema.Properties["name"] = NewStringSchema()
		schema.Properties["age"] = NewIntegerSchema()

		// Mark id and age as required
		schema.Required = []string{"id", "age"}

		// Serialize and check
		data, err := json.MarshalIndent(schema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "properties": {
    "age": {
      "type": [
        "integer",
        "null"
      ]
    },
    "id": {
      "type": [
        "string",
        "null"
      ]
    },
    "name": {
      "type": [
        "string",
        "null"
      ]
    }
  },
  "required": [
    "id",
    "age"
  ],
  "type": [
    "object",
    "null"
  ]
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("numeric constraints", func(t *testing.T) {
		// Test numeric constraints (min/max)
		min := float64(0)
		max := float64(100)

		// Integer schema
		intSchema := NewIntegerSchema()
		intSchema.Minimum = &min
		intSchema.Maximum = &max

		data, err := json.MarshalIndent(intSchema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema for integer
		expectedIntJSON := `{
  "type": ["integer", "null"],
  "minimum": 0,
  "maximum": 100
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedIntJSON, string(data), "Integer schema does not match expected structure")

		// Number schema
		numSchema := NewNumberSchema()
		numSchema.Minimum = &min
		numSchema.Maximum = &max

		data, err = json.MarshalIndent(numSchema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema for number
		expectedNumJSON := `{
  "type": ["number", "null"],
  "minimum": 0,
  "maximum": 100
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedNumJSON, string(data), "Number schema does not match expected structure")
	})

	t.Run("string format", func(t *testing.T) {
		// Test string format
		schema := NewStringSchema()
		schema.Format = "email"

		data, err := json.Marshal(schema)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "email", parsed["format"])
	})

	t.Run("default values", func(t *testing.T) {
		// Test default values for different types
		stringSchema := NewStringSchema()
		stringSchema.Default = "default string"

		intSchema := NewIntegerSchema()
		intSchema.Default = 42

		boolSchema := NewBooleanSchema()
		boolSchema.Default = true

		// Test object with default values
		objSchema := NewObjectSchema()
		objSchema.Properties["str"] = stringSchema
		objSchema.Properties["num"] = intSchema
		objSchema.Properties["bool"] = boolSchema

		data, err := json.Marshal(objSchema)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		properties := parsed["properties"].(map[string]any)

		strProp := properties["str"].(map[string]any)
		assert.Equal(t, "default string", strProp["default"])

		numProp := properties["num"].(map[string]any)
		assert.Equal(t, float64(42), numProp["default"])

		boolProp := properties["bool"].(map[string]any)
		assert.Equal(t, true, boolProp["default"])
	})

	t.Run("pattern validation", func(t *testing.T) {
		// Test pattern validation for strings
		schema := NewStringSchema()
		schema.Pattern = "^[a-zA-Z0-9]+$"

		data, err := json.Marshal(schema)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "^[a-zA-Z0-9]+$", parsed["pattern"])
	})

	t.Run("nullable types", func(t *testing.T) {
		// Test all nullable types
		schemas := []*JsonSchema{
			NewObjectSchema(),
			NewArraySchema(NewStringSchema()),
			NewStringSchema(),
			NewIntegerSchema(),
			NewNumberSchema(),
			NewBooleanSchema(),
			NewEnumSchema([]string{"A", "B"}),
		}

		for _, schema := range schemas {
			data, err := json.Marshal(schema)
			require.NoError(t, err)

			var parsed map[string]any
			err = json.Unmarshal(data, &parsed)
			require.NoError(t, err)

			// A nullable schema serializes "type" as the JSON Schema 2020-12 two-
			// element array [<primary>, "null"], not the OpenAPI "nullable: true".
			typeArr, ok := parsed["type"].([]any)
			require.True(t, ok, "nullable schema should serialize type as an array")
			require.Len(t, typeArr, 2)
			require.Contains(t, typeArr, "null")
			require.NotEqual(t, "null", typeArr[0],
				"primary (non-null) type should appear first in the type array")
		}
	})

	t.Run("fluent interface", func(t *testing.T) {
		// Test fluent interface for building schemas
		schema := NewStringSchema().
			WithDescription("A string with format and default").
			WithFormat("email").
			WithDefault("user@example.com")

		data, err := json.Marshal(schema)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "A string with format and default", parsed["description"])
		assert.Equal(t, "email", parsed["format"])
		assert.Equal(t, "user@example.com", parsed["default"])
	})

	t.Run("complex nested schema", func(t *testing.T) {
		// Test a complex schema with all features
		userSchema := NewObjectSchema()
		userSchema.Description = "User schema with all features"

		// Required string with pattern
		idSchema := NewStringSchema()
		idSchema.Pattern = "^[a-zA-Z0-9]{8,}$"
		userSchema.Properties["id"] = idSchema
		userSchema.Required = append(userSchema.Required, "id")

		// String with format and default
		emailSchema := NewStringSchema()
		emailSchema.Format = "email"
		emailSchema.Default = "user@example.com"
		userSchema.Properties["email"] = emailSchema

		// Integer with constraints
		min := float64(13)
		ageSchema := NewIntegerSchema()
		ageSchema.Minimum = &min
		userSchema.Properties["age"] = ageSchema

		// Enum property
		roleSchema := NewEnumSchema([]string{"ADMIN", "USER", "GUEST"})
		roleSchema.Default = "USER"
		userSchema.Properties["role"] = roleSchema

		// Array of strings
		tagsSchema := NewArraySchema(NewStringSchema())
		userSchema.Properties["tags"] = tagsSchema

		// Nested object
		addressSchema := NewObjectSchema()
		addressSchema.Properties["street"] = NewStringSchema()
		addressSchema.Properties["city"] = NewStringSchema()
		addressSchema.Required = append(addressSchema.Required, "street")
		userSchema.Properties["address"] = addressSchema

		// Serialize the whole thing
		data, err := json.MarshalIndent(userSchema, "", "  ")
		require.NoError(t, err)

		// Define expected JSON schema
		expectedJSON := `{
  "additionalProperties": false,
  "description": "User schema with all features",
  "properties": {
    "address": {
      "additionalProperties": false,
      "properties": {
        "city": {
          "type": [
            "string",
            "null"
          ]
        },
        "street": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "street"
      ],
      "type": [
        "object",
        "null"
      ]
    },
    "age": {
      "minimum": 13,
      "type": [
        "integer",
        "null"
      ]
    },
    "email": {
      "default": "user@example.com",
      "format": "email",
      "type": [
        "string",
        "null"
      ]
    },
    "id": {
      "pattern": "^[a-zA-Z0-9]{8,}$",
      "type": [
        "string",
        "null"
      ]
    },
    "role": {
      "default": "USER",
      "enum": [
        "ADMIN",
        "USER",
        "GUEST",
        null
      ],
      "type": [
        "string",
        "null"
      ]
    },
    "tags": {
      "items": {
        "type": [
          "string",
          "null"
        ]
      },
      "type": [
        "array",
        "null"
      ]
    }
  },
  "required": [
    "id"
  ],
  "type": [
    "object",
    "null"
  ]
}`

		// Compare actual JSON with expected JSON
		assert.JSONEq(t, expectedJSON, string(data), "JSON schema does not match expected structure")
	})

	t.Run("nullable schema property", func(t *testing.T) {
		// Test creating schemas with different nullable settings

		// Create a schema with nullable field
		schema := NewObjectSchema()
		schema.Properties["nullableString"] = NewStringSchema().WithNullable(true)
		schema.Properties["nonNullableString"] = NewStringSchema().WithNullable(false)

		// By default, all types should be nullable
		schema.Properties["defaultString"] = NewStringSchema()

		// Check that factory methods set nullable to true by default
		intSchema := NewIntegerSchema()
		assert.True(t, intSchema.Nullable)

		numSchema := NewNumberSchema()
		assert.True(t, numSchema.Nullable)

		boolSchema := NewBooleanSchema()
		assert.True(t, boolSchema.Nullable)

		enumSchema := NewEnumSchema([]string{"A", "B"})
		assert.True(t, enumSchema.Nullable)

		arraySchema := NewArraySchema(NewStringSchema())
		assert.True(t, arraySchema.Nullable)

		objSchema := NewObjectSchema()
		assert.True(t, objSchema.Nullable)

		// Test serialization
		data, err := json.Marshal(schema)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		properties := parsed["properties"].(map[string]any)

		// Nullability is expressed via the JSON Schema 2020-12 type-union form,
		// not the OpenAPI "nullable" keyword (which is no longer emitted).

		// Explicitly nullable property: "type" is the two-element [<t>, "null"] array.
		nullableProp := properties["nullableString"].(map[string]any)
		assert.Equal(t, []any{"string", "null"}, nullableProp["type"])
		_, hasNullableKey := nullableProp["nullable"]
		assert.False(t, hasNullableKey, "nullable keyword should not be emitted")

		// Non-nullable property: "type" is a single string and no "nullable" key.
		nonNullableProp := properties["nonNullableString"].(map[string]any)
		assert.Equal(t, "string", nonNullableProp["type"])
		_, hasNullableOnNonNullable := nonNullableProp["nullable"]
		assert.False(t, hasNullableOnNonNullable)

		// Default (factory-nullable) property: same shape as explicitly nullable.
		defaultProp := properties["defaultString"].(map[string]any)
		assert.Equal(t, []any{"string", "null"}, defaultProp["type"])

		// Test WithNullable method
		schema = NewStringSchema()
		schema.WithNullable(true)
		assert.True(t, schema.Nullable)

		schema.WithNullable(false)
		assert.False(t, schema.Nullable)
	})
}

func TestJsonSchemaClone(t *testing.T) {
	t.Run("mutating the clone does not affect the original", func(t *testing.T) {
		additionalProps := false
		minimum := 1.0
		original := &JsonSchema{
			Type:                 TypeObject,
			Properties:           map[string]*JsonSchema{"name": NewStringSchema()},
			Required:             []string{"name"},
			AdditionalProperties: &additionalProps,
			Description:          "original",
			Nullable:             true,
			Items:                NewStringSchema(),
			Enum:                 []string{"a", "b"},
			Minimum:              &minimum,
		}

		clone := original.Clone()

		clone.Nullable = false
		clone.Description = "mutated"
		clone.Properties["name"].Type = TypeInteger
		clone.Required[0] = "changed"
		*clone.AdditionalProperties = true
		clone.Items.Type = TypeBoolean
		clone.Enum[0] = "z"
		*clone.Minimum = 99

		assert.True(t, original.Nullable)
		assert.Equal(t, "original", original.Description)
		assert.Equal(t, TypeString, original.Properties["name"].Type)
		assert.Equal(t, "name", original.Required[0])
		assert.False(t, *original.AdditionalProperties)
		assert.Equal(t, TypeString, original.Items.Type)
		assert.Equal(t, "a", original.Enum[0])
		assert.Equal(t, 1.0, *original.Minimum)
	})

	t.Run("nil receiver returns nil", func(t *testing.T) {
		var s *JsonSchema
		assert.Nil(t, s.Clone())
	})
}
