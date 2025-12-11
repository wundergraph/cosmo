package core

import "github.com/wundergraph/astjson"

// FieldArguments allow access to GraphQL field arguments used by clients.
type FieldArguments struct {
	data map[string]map[string]*astjson.Value
}

// Get will return the value of argument a from field f.
//
// The field needs to be a dot notated path to the position of the field.
// For example if you want to access arg1 on field2 on the operation
//
//	subscription {
//		mySub(arg1: "val1", arg2: "val2") {
//			field1
//			field2(arg1: "val3", arg2: "val4")
//		}
//
// You need to call Get("mySub.field2", "arg1") .
// If f or a cannot be found nil is returned.
func (fa *FieldArguments) Get(f string, a string) *astjson.Value {
	args, found := fa.data[f]
	if !found {
		return nil
	}

	v, _ := args[a]
	return v
}
