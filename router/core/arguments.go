package core

import (
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
)

// Arguments allow access to GraphQL field arguments used by clients.
type Arguments struct {
	// mapping maps "fieldPath.argumentName" to "variableName".
	// For example: {"user.posts.limit": "a", "user.id": "userId"}
	mapping astnormalization.FieldArgumentMapping

	// variables contains the JSON-parsed variables from the request.
	variables *astjson.Value
}

// NewArguments creates an Arguments instance.
func NewArguments(
	mapping astnormalization.FieldArgumentMapping,
	variables *astjson.Value,
) Arguments {
	return Arguments{
		mapping:   mapping,
		variables: variables,
	}
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
	if fa == nil || len(fa.mapping) == 0 || fa.variables == nil {
		return nil
	}

	// Build the mapping key: "fieldPath.argumentName"
	key := f + "." + a

	// Look up variable name from mapping
	varName, ok := fa.mapping[key]
	if !ok {
		return nil
	}

	return fa.variables.Get(varName)
}
