package core

import (
	"strings"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
)

// fieldArgs is a collection of field arguments with their names
// as keys and their corresponding values.
type fieldArgs map[string]*astjson.Value

// Arguments allow access to GraphQL field arguments used by clients.
type Arguments struct {
	// data holds a map which contains all field arguments
	// for any given field of an operation.
	data map[string]fieldArgs
}

// NewArgumentsFromMapping creates Arguments using the cached field argument mapping
// and the request's variable values. This is O(m) where m is the number of arguments,
// compared to the previous O(n) AST walk where n is the number of AST nodes.
//
// The mapping parameter maps "fieldPath.argumentName" to "variableName".
// For example: {"user.posts.limit": "a", "user.id": "userId"}
//
// The variables parameter contains the JSON-parsed variables from the request.
// The remapVariables parameter maps new variable names to original variable names.
func NewArgumentsFromMapping(
	mapping astnormalization.FieldArgumentMapping,
	variables *astjson.Value,
	remapVariables map[string]string,
) Arguments {
	if len(mapping) == 0 {
		return Arguments{}
	}

	data := make(map[string]fieldArgs, len(mapping))

	for key, varName := range mapping {
		// key format: "fieldPath.argumentName" (e.g., "user.posts.limit")
		// We need to split by the last "." to separate field path from argument name
		lastDot := strings.LastIndex(key, ".")
		if lastDot == -1 {
			// No dot found, skip this entry (shouldn't happen with valid data)
			continue
		}

		fieldPath := key[:lastDot]
		argName := key[lastDot+1:]

		// Look up the original variable name if remapping is in effect
		originalVarName := varName
		if remapVariables != nil {
			if original, ok := remapVariables[varName]; ok {
				originalVarName = original
			}
		}

		// Get the variable value from the parsed variables
		var argValue *astjson.Value
		if variables != nil {
			argValue = variables.Get(originalVarName)
		}

		// Initialize the field's argument map if needed
		if data[fieldPath] == nil {
			data[fieldPath] = make(fieldArgs)
		}
		data[fieldPath][argName] = argValue
	}

	return Arguments{data: data}
}

// Get will return the value of argument a from field f.
//
// To access an argument of a root level field, you need to pass the
// response key of the field as the first argument to Get and the name of the argument
// as the second argument, e.g. Get("rootfield_name", "argument_name") .
//
// The response key is the alias if present, otherwise the field name.
// For aliased fields like "myAlias: user(id: 1)", use the alias "myAlias" in the path.
//
// The field path uses dot notation for nested fields.
// For example you can access arg1 on field2 on the operation
//
//	subscription {
//		mySub(arg1: "val1", arg2: "val2") {
//			field1
//			field2(arg1: "val3", arg2: "val4")
//		}
//	}
//
// You need to call Get("mySub.field2", "arg1") .
//
// For aliased fields:
//
//	query {
//		a: user(id: "1") { name }
//		b: user(id: "2") { name }
//	}
//
// You need to call Get("a", "id") or Get("b", "id") respectively.
//
// If fa is nil, or f or a cannot be found, nil is returned.
func (fa *Arguments) Get(f string, a string) *astjson.Value {
	if fa == nil || fa.data == nil {
		return nil
	}

	args, found := fa.data[f]
	if !found {
		return nil
	}

	return args[a]
}
