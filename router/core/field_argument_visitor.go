package core

import (
	"fmt"
	"strings"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
)

type fieldArgumentsVisitor struct {
	walker         *astvisitor.Walker
	operation      *ast.Document
	definition     *ast.Document
	variables      *astjson.Value
	remapVariables map[string]string
	fieldArguments map[string]map[string]*astjson.Value
	logger         *zap.Logger
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

	fieldPath := v.dotPathFromAncestors()

	if v.fieldArguments[fieldPath] == nil {
		v.fieldArguments[fieldPath] = make(map[string]*astjson.Value)
	}

	argName := v.operation.ArgumentNameString(ref)
	argVal := v.operation.Arguments[ref].Value

	resolvedArgVal, err := v.resolveArgValue(argVal)
	if err != nil {
		v.logger.
			With(zap.String("fieldPath", fieldPath), zap.String("argName", argName)).
			Warn("failed to resolve argument value", zap.Error(err))
		return
	}

	v.fieldArguments[fieldPath][argName] = resolvedArgVal
}

func (v *fieldArgumentsVisitor) dotPathFromAncestors() string {
	var pathParts []string

	for _, anc := range v.walker.Ancestors {
		if anc.Kind == ast.NodeKindField {
			fieldName := v.operation.FieldNameString(anc.Ref)
			pathParts = append(pathParts, fieldName)
		}
	}

	return strings.Join(pathParts, ".")
}

// resolveArgValue returns the value of val as astjson.Value.
func (v *fieldArgumentsVisitor) resolveArgValue(val ast.Value) (*astjson.Value, error) {
	if val.Kind != ast.ValueKindVariable {
		// Normally we never hit this code path because val.Kind should always be ast.ValueKindVariable.
		// The operation parser automically creates variables and maps them to arguments,
		// even if no initial variables are provided.
		// We should still be able to deal with arguments directly,
		// if for some reason they are not mapped to variables.
		return v.getArgValueFromDoc(val)
	}

	return v.getArgValueFromVars(val)
}

func (v *fieldArgumentsVisitor) getArgValueFromDoc(val ast.Value) (*astjson.Value, error) {
	mval, err := v.operation.ValueToJSON(val)
	if err != nil {
		return nil, fmt.Errorf("marshal ast value: %w", err)
	}

	res, err := astjson.ParseBytes(mval)
	if err != nil {
		return nil, fmt.Errorf("parse marshalled data as astjson.Value: %w", err)
	}

	return res, nil
}

func (v *fieldArgumentsVisitor) getArgValueFromVars(val ast.Value) (*astjson.Value, error) {
	varName := v.operation.VariableValueNameString(val.Ref)
	originalVarName := varName
	if v.remapVariables != nil {
		if original, ok := v.remapVariables[varName]; ok {
			originalVarName = original
		}
	}

	return v.variables.Get(originalVarName), nil
}

type mapFieldArgumentsOpts struct {
	operation      *ast.Document
	definition     *ast.Document
	vars           *astjson.Value
	remapVariables map[string]string
	logger         *zap.Logger
}

func mapFieldArguments(opts mapFieldArgumentsOpts) Arguments {
	walker := astvisitor.NewWalker(48)

	visitor := &fieldArgumentsVisitor{
		walker:         &walker,
		variables:      opts.vars,
		remapVariables: opts.remapVariables,
		fieldArguments: make(map[string]map[string]*astjson.Value),
		logger:         opts.logger,
	}

	walker.RegisterEnterDocumentVisitor(visitor)
	walker.RegisterEnterArgumentVisitor(visitor)

	report := &operationreport.Report{}
	walker.Walk(opts.operation, opts.definition, report)

	res := Arguments{
		data: visitor.fieldArguments,
	}

	return res
}
