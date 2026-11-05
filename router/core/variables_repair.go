package core

import (
	"bytes"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astimport"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// variablesRepairer reconciles variable declarations with the positions the
// variables are used in, for variables nested inside list or input object
// literals. Variable extraction serializes such literals to JSON and resolves
// the nested variables by name from the request, so the declaration only
// matters to the validator. Variables used directly as argument values are
// left alone. Both repairs are opt-in deviations from the "All Variable Uses
// Defined" and "All Variable Usages Are Allowed" rules.
//
//   - undeclared: a missing declaration is added with the position type.
//   - retype: an incompatible declared type is replaced by the position type.
//     Declarations with default values or unknown named types are left alone.
//
// A variable used in two positions with different types is repaired for the
// first position only. The validator reports the second.
type variablesRepairer struct {
	walker                astvisitor.Walker
	operation, definition *ast.Document
	importer              astimport.Importer
	undeclared, retype    bool
	repaired, retyped     []string
	changed               map[int]struct{} // variable definition refs changed in this walk
}

func newVariablesRepairer(undeclared, retype bool) *variablesRepairer {
	r := &variablesRepairer{
		walker:     astvisitor.NewWalker(8),
		undeclared: undeclared,
		retype:     retype,
		changed:    map[int]struct{}{},
	}
	r.walker.RegisterEnterDocumentVisitor(r)
	r.walker.RegisterEnterArgumentVisitor(r)

	return r
}

func (v *variablesRepairer) Repair(operation, definition *ast.Document, report *operationreport.Report) (repaired, retyped []string) {
	v.walker.Walk(operation, definition, report)
	return v.repaired, v.retyped
}

func (v *variablesRepairer) EnterDocument(operation, definition *ast.Document) {
	v.operation, v.definition = operation, definition
	v.repaired, v.retyped = nil, nil // results are cached, never reuse the arrays
	clear(v.changed)
}

func (v *variablesRepairer) EnterArgument(ref int) {
	if len(v.walker.Ancestors) == 0 || v.walker.Ancestors[0].Kind != ast.NodeKindOperationDefinition {
		return
	}

	for i := range v.walker.Ancestors {
		if v.walker.Ancestors[i].Kind == ast.NodeKindDirective {
			return
		}
	}

	defRef, ok := v.walker.ArgumentInputValueDefinition(ref)
	if !ok {
		return
	}

	v.repairInputValue(v.operation.ArgumentValue(ref), defRef, false)
}

func (v *variablesRepairer) repairInputValue(value ast.Value, inputValueDefRef int, nested bool) {
	posType := v.definition.InputValueDefinitions[inputValueDefRef].Type
	// A position with a default value accepts a nullable variable.
	if v.definition.InputValueDefinitions[inputValueDefRef].DefaultValue.IsDefined && v.definition.Types[posType].TypeKind == ast.TypeKindNonNull {
		posType = v.definition.Types[posType].OfType
	}

	v.repair(value, posType, nested)
}

func (v *variablesRepairer) repair(value ast.Value, posType int, nested bool) {
	switch value.Kind {
	case ast.ValueKindVariable:
		if nested {
			v.reconcile(value.Ref, posType)
		}
	case ast.ValueKindList:
		listType := v.definition.ResolveListOrNameType(posType)
		if v.definition.Types[listType].TypeKind != ast.TypeKindList {
			return
		}

		for _, itemRef := range v.operation.ListValues[value.Ref].Refs {
			v.repair(v.operation.Value(itemRef), v.definition.Types[listType].OfType, true)
		}
	case ast.ValueKindObject:
		node, ok := v.definition.Index.FirstNodeByNameBytes(v.definition.ResolveTypeNameBytes(posType))
		if !ok || node.Kind != ast.NodeKindInputObjectTypeDefinition {
			return
		}

		for _, fieldRef := range v.operation.ObjectValues[value.Ref].Refs {
			fieldDef := v.definition.InputObjectTypeDefinitionInputValueDefinitionByName(node.Ref, v.operation.ObjectFieldNameBytes(fieldRef))
			if fieldDef == ast.InvalidRef {
				continue
			}

			v.repairInputValue(v.operation.ObjectFieldValue(fieldRef), fieldDef, true)
		}
	}
}

func (v *variablesRepairer) reconcile(variableValueRef, posType int) {
	operationRef := v.walker.Ancestors[0].Ref
	name := v.operation.VariableValueNameBytes(variableValueRef)

	defRef, exists := v.operation.VariableDefinitionByNameAndOperation(operationRef, name)
	if exists {
		if !v.retype {
			return
		}

		if _, done := v.changed[defRef]; done {
			return
		}

		if v.operation.VariableDefinitionHasDefaultValue(defRef) {
			return
		}

		varType := v.operation.VariableDefinitions[defRef].Type
		if _, known := v.definition.Index.FirstNodeByNameBytes(v.operation.ResolveTypeNameBytes(varType)); !known {
			return
		}

		if v.compatible(varType, posType) {
			return
		}

		v.operation.VariableDefinitions[defRef].Type = v.importer.ImportType(posType, v.definition, v.operation)
		v.changed[defRef] = struct{}{}
		v.retyped = append(v.retyped, string(name))

		return
	}

	if !v.undeclared {
		return
	}

	definitionValueRef := v.operation.AddVariableValue(ast.VariableValue{Name: v.operation.VariableValues[variableValueRef].Name})
	typeRef := v.importer.ImportType(posType, v.definition, v.operation)
	v.operation.AddVariableDefinitionToOperationDefinition(operationRef, definitionValueRef, typeRef)
	v.changed[len(v.operation.VariableDefinitions)-1] = struct{}{}
	v.repaired = append(v.repaired, string(name))
}

// compatible implements AreTypesCompatible from the "All Variable Usages Are
// Allowed" rule. Callers strip non-null from positions that have a default.
func (v *variablesRepairer) compatible(varType, posType int) bool {
	op, def := v.operation, v.definition
	switch {
	case def.Types[posType].TypeKind == ast.TypeKindNonNull:
		if op.Types[varType].TypeKind != ast.TypeKindNonNull {
			return false
		}

		return v.compatible(op.Types[varType].OfType, def.Types[posType].OfType)
	case op.Types[varType].TypeKind == ast.TypeKindNonNull:
		return v.compatible(op.Types[varType].OfType, posType)
	case def.Types[posType].TypeKind == ast.TypeKindList:
		if op.Types[varType].TypeKind != ast.TypeKindList {
			return false
		}

		return v.compatible(op.Types[varType].OfType, def.Types[posType].OfType)
	case op.Types[varType].TypeKind == ast.TypeKindList:
		return false
	default:
		return bytes.Equal(op.TypeNameBytes(varType), def.TypeNameBytes(posType))
	}
}
