package core

import (
	"strings"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

type fieldArgumentsVisitor struct {
	walker         *astvisitor.Walker
	operation      *ast.Document
	definition     *ast.Document
	variables      *astjson.Value
	remapVariables map[string]string
	fieldArguments map[string]map[string]any
}

func (v *fieldArgumentsVisitor) EnterDocument(operation, definition *ast.Document) {
	v.operation = operation
	v.definition = definition
}

func (v *fieldArgumentsVisitor) EnterArgument(ref int) {
	// skip if we don't deal with field arguments (e.g. directive arguments)
	anc := v.walker.Ancestors[len(v.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}

	// build path from ancestors
	var pathParts []string
	for _, anc := range v.walker.Ancestors {
		if anc.Kind == ast.NodeKindField {
			fieldName := v.operation.FieldNameString(anc.Ref)
			pathParts = append(pathParts, fieldName)
		}
	}
	fieldPath := strings.Join(pathParts, ".")

	if v.fieldArguments[fieldPath] == nil {
		v.fieldArguments[fieldPath] = make(map[string]any)
	}

	argName := v.operation.ArgumentNameString(ref)
	val := v.operation.Arguments[ref].Value
	v.fieldArguments[fieldPath][argName] = getArgValue(v.operation, val, v.variables, v.remapVariables)
}

func mapFieldArguments(operation *ast.Document, definition *ast.Document,
	vars *astjson.Value, remapVariables map[string]string) map[string]map[string]any {
	walker := astvisitor.NewWalker(48)

	visitor := &fieldArgumentsVisitor{
		walker:         &walker,
		variables:      vars,
		remapVariables: remapVariables,
		fieldArguments: make(map[string]map[string]any),
	}

	walker.RegisterEnterDocumentVisitor(visitor)
	walker.RegisterEnterArgumentVisitor(visitor)

	report := &operationreport.Report{}
	walker.Walk(operation, definition, report)

	return visitor.fieldArguments
}

// getArgValue returns the actual value of val.
// It resolves variables in case these have been used for arguments,
// else it will use values from doc.
func getArgValue(doc *ast.Document, val ast.Value, variables *astjson.Value, remapVariables map[string]string) any {
	if val.Kind != ast.ValueKindVariable {
		// TODO delete this comment.
		// I observed we never actually hit this code path because the operation parser
		// automically creates variables and maps them to arguments, even if no initial variables are provided.
		// We should probably still have this in place just in case.
		// Maybe there is a better way than to to use ValueToJSON but I haven't found one yet.
		actualValue, err := doc.ValueToJSON(val)
		if err != nil {
			// TODO error handling
			return nil
		}
		// TODO: Type cast to what this actually is, it returns only []byte atm
		return actualValue
	}

	varName := doc.VariableValueNameString(val.Ref)
	originalVarName := varName
	if remapVariables != nil {
		if original, ok := remapVariables[varName]; ok {
			originalVarName = original
		}
	}

	varValue := variables.Get(originalVarName)
	switch varValue.Type() {
	case astjson.TypeNumber:
		return varValue.GetInt()
	case astjson.TypeString:
		return string(varValue.GetStringBytes())
	case astjson.TypeObject:
		// TODO maybe create map out of varValue to give hook developers a better experience.
		// The problem is this would be a nested operation because objects can contain all kinds
		// of children elements, such as numbers, strings, other objects, etc.
		// Right now we only return the astjson type directly and leave it to the hook developer
		// to work with that.
		return varValue.GetObject()
	case astjson.TypeArray:
		// TODO maybe create slice out of varValue to give hook developers a better experience.
		// The problem is this would be a nested operation because arrays can contain all kinds
		// of children elements, such as numbers, strings, other objects, etc.
		// Right now we only return the astjson type directly and leave it to the hook developer
		// to work with that.
		return varValue.GetArray()
	case astjson.TypeFalse:
		// TODO hypothetically written, needs testing
		return false
	case astjson.TypeTrue:
		// TODO hypothetically written, needs testing
		return true
	default:
		// TODO test for type = null
		return nil
	}
}
