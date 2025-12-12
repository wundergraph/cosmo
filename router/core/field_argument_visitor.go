package core

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
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
	if len(v.walker.Ancestors) == 0 {
		return
	}

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
			// Use the response key (alias if present, otherwise field name)
			// to handle aliased fields and repeated selections correctly
			responseKey := v.fieldResponseKey(anc.Ref)
			pathParts = append(pathParts, responseKey)
		}
	}

	return strings.Join(pathParts, ".")
}

// fieldResponseKey returns the response key for a field (alias if present, otherwise field name).
// This ensures unique paths for aliased fields like: a: user(id: 1) and b: user(id: 2)
func (v *fieldArgumentsVisitor) fieldResponseKey(fieldRef int) string {
	alias := v.operation.FieldAliasString(fieldRef)
	if alias != "" {
		return alias
	}
	return v.operation.FieldNameString(fieldRef)
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
	if v.variables == nil {
		return nil, errors.New("value kind is of type 'variable' but no variables are set")
	}

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

	logger := opts.logger
	if logger == nil {
		logger = zap.NewNop()
	}

	visitor := &fieldArgumentsVisitor{
		walker:         &walker,
		variables:      opts.vars,
		remapVariables: opts.remapVariables,
		fieldArguments: make(map[string]map[string]*astjson.Value),
		logger:         logger,
	}

	walker.RegisterEnterDocumentVisitor(visitor)
	walker.RegisterEnterArgumentVisitor(visitor)

	report := &operationreport.Report{}
	walker.Walk(opts.operation, opts.definition, report)
	if report.HasErrors() {
		logger.Warn("failed to map field arguments, no arguments will be available",
			zap.Error(errors.New(report.Error())))
		return Arguments{}
	}

	res := Arguments{
		data: visitor.fieldArguments,
	}

	return res
}
