package core

import "github.com/wundergraph/astjson"

// Arguments allow access to GraphQL field arguments used by clients.
type Arguments struct {
	// First key is the path to the field in dot notation
	// i.e. root_field.subfield1.subfield2.
	// Second argument is the name of the argument of that field.
	data map[string]map[string]*astjson.Value
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
	if fa == nil {
		return nil
	}

	args, found := fa.data[f]
	if !found {
		return nil
	}

	return args[a]
}
