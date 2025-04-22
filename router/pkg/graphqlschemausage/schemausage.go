package graphqlschemausage

import (
	"slices"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

func GetTypeFieldUsageInfo(operationPlan plan.Plan) []*TypeFieldUsageInfo {
	visitor := typeFieldUsageInfoVisitor{}
	switch p := operationPlan.(type) {
	case *plan.SynchronousResponsePlan:
		visitor.visitNode(p.Response.Data, nil)
	case *plan.SubscriptionResponsePlan:
		visitor.visitNode(p.Response.Response.Data, nil)
	}
	return visitor.typeFieldUsageInfo
}

// An array of TypeFieldUsageInfo, with a method to convert it into a []*graphqlmetrics.TypeFieldUsageInfo
type TypeFieldMetrics []*TypeFieldUsageInfo

// IntoGraphQLMetrics converts the TypeFieldMetrics into a []*graphqlmetrics.TypeFieldUsageInfo
func (t TypeFieldMetrics) IntoGraphQLMetrics() []*graphqlmetrics.TypeFieldUsageInfo {
	metrics := make([]*graphqlmetrics.TypeFieldUsageInfo, len(t))
	for i, info := range t {
		metrics[i] = info.IntoGraphQLMetrics()
	}
	return metrics
}

// TypeFieldUsageInfo holds information about the usage of a GraphQL type
type TypeFieldUsageInfo struct {
	NamedType           string
	ExactParentTypeName string

	Path                   []string
	ParentTypeNames        []string
	SubgraphIDs            []string
	IndirectInterfaceField bool
}

// IntoGraphQLMetrics converts the graphqlschemausage.TypeFieldUsageInfo into a *graphqlmetrics.TypeFieldUsageInfo
func (t *TypeFieldUsageInfo) IntoGraphQLMetrics() *graphqlmetrics.TypeFieldUsageInfo {
	return &graphqlmetrics.TypeFieldUsageInfo{
		Path:                   t.Path,
		TypeNames:              t.ParentTypeNames,
		SubgraphIDs:            t.SubgraphIDs,
		NamedType:              t.NamedType,
		IndirectInterfaceField: t.IndirectInterfaceField,
		Count:                  0,
	}
}

type typeFieldUsageInfoVisitor struct {
	typeFieldUsageInfo []*TypeFieldUsageInfo
}

func (p *typeFieldUsageInfoVisitor) visitNode(node resolve.Node, path []string) {
	switch t := node.(type) {
	case *resolve.Object:
		for _, field := range t.Fields {
			if field.Info == nil {
				continue
			}
			pathCopy := slices.Clone(append(path, field.Info.Name))
			p.typeFieldUsageInfo = append(p.typeFieldUsageInfo, &TypeFieldUsageInfo{
				Path:                pathCopy,
				ParentTypeNames:     field.Info.ParentTypeNames,
				ExactParentTypeName: field.Info.ExactParentTypeName,
				SubgraphIDs:         field.Info.Source.IDs,
				NamedType:           field.Info.NamedType,
			})
			if len(field.Info.IndirectInterfaceNames) > 0 {
				p.typeFieldUsageInfo = append(p.typeFieldUsageInfo, &TypeFieldUsageInfo{
					Path:                   pathCopy,
					ParentTypeNames:        field.Info.IndirectInterfaceNames,
					SubgraphIDs:            field.Info.Source.IDs,
					NamedType:              field.Info.NamedType,
					IndirectInterfaceField: true,
				})
			}
			p.visitNode(field.Value, pathCopy)
		}
	case *resolve.Array:
		p.visitNode(t.Item, path)
	}
}

func GetArgumentUsageInfo(operation, definition *ast.Document) ([]*graphqlmetrics.ArgumentUsageInfo, error) {
	walker := astvisitor.NewWalker(48)
	visitor := &argumentUsageInfoVisitor{
		definition: definition,
		operation:  operation,
		walker:     &walker,
	}
	walker.RegisterEnterArgumentVisitor(visitor)
	walker.RegisterEnterFieldVisitor(visitor)
	rep := &operationreport.Report{}
	walker.Walk(operation, definition, rep)
	if rep.HasErrors() {
		return nil, rep
	}
	return visitor.usage, nil
}

type argumentUsageInfoVisitor struct {
	walker                *astvisitor.Walker
	definition, operation *ast.Document
	fieldEnclosingNode    ast.Node
	usage                 []*graphqlmetrics.ArgumentUsageInfo
}

func (a *argumentUsageInfoVisitor) EnterField(_ int) {
	a.fieldEnclosingNode = a.walker.EnclosingTypeDefinition
}

func (a *argumentUsageInfoVisitor) EnterArgument(ref int) {
	argName := a.operation.ArgumentNameBytes(ref)
	anc := a.walker.Ancestors[len(a.walker.Ancestors)-1]
	if anc.Kind != ast.NodeKindField {
		return
	}
	fieldName := a.operation.FieldNameBytes(anc.Ref)
	enclosingTypeName := a.definition.NodeNameBytes(a.fieldEnclosingNode)
	argDef := a.definition.NodeFieldDefinitionArgumentDefinitionByName(a.fieldEnclosingNode, fieldName, argName)
	if argDef == -1 {
		return
	}
	argType := a.definition.InputValueDefinitionType(argDef)
	typeName := a.definition.ResolveTypeNameBytes(argType)
	a.usage = append(a.usage, &graphqlmetrics.ArgumentUsageInfo{
		Path:      []string{string(fieldName), string(argName)},
		TypeName:  string(enclosingTypeName),
		NamedType: string(typeName),
	})
}

func GetInputUsageInfo(operation, definition *ast.Document, variables *astjson.Value) ([]*graphqlmetrics.InputUsageInfo, error) {
	visitor := &inputUsageInfoVisitor{
		operation:  operation,
		definition: definition,
		variables:  variables,
	}
	for i := range operation.VariableDefinitions {
		visitor.EnterVariableDefinition(i)
	}
	return visitor.usage, nil
}

type inputUsageInfoVisitor struct {
	definition, operation *ast.Document
	variables             *astjson.Value
	usage                 []*graphqlmetrics.InputUsageInfo
}

func (v *inputUsageInfoVisitor) EnterVariableDefinition(ref int) {
	varTypeRef := v.operation.VariableDefinitions[ref].Type
	varName := v.operation.VariableValueNameString(v.operation.VariableDefinitions[ref].VariableValue.Ref)
	varTypeName := v.operation.ResolveTypeNameString(varTypeRef)
	jsonField := v.variables.Get(varName)
	if jsonField == nil {
		return
	}
	v.traverseVariable(jsonField, varName, varTypeName, "")
}

func (v *inputUsageInfoVisitor) traverseVariable(jsonValue *astjson.Value, fieldName, typeName, parentTypeName string) {
	defNode, ok := v.definition.NodeByNameStr(typeName)
	if !ok {
		return
	}
	usageInfo := &graphqlmetrics.InputUsageInfo{
		NamedType: typeName,
	}
	if parentTypeName != "" {
		usageInfo.TypeName = parentTypeName
		usageInfo.Path = []string{parentTypeName, fieldName}
	}

	switch defNode.Kind {
	case ast.NodeKindInputObjectTypeDefinition:
		switch jsonValue.Type() {
		case astjson.TypeArray:
			for _, arrayValue := range jsonValue.GetArray() {
				v.traverseVariable(arrayValue, fieldName, typeName, parentTypeName)
			}
		case astjson.TypeObject:
			o := jsonValue.GetObject()
			o.Visit(func(key []byte, value *astjson.Value) {
				fieldRef := v.definition.InputObjectTypeDefinitionInputValueDefinitionByName(defNode.Ref, key)
				if fieldRef == -1 {
					return
				}
				fieldTypeName := v.definition.ResolveTypeNameString(v.definition.InputValueDefinitions[fieldRef].Type)
				if v.definition.TypeIsList(v.definition.InputValueDefinitions[fieldRef].Type) {
					for _, arrayValue := range value.GetArray() {
						v.traverseVariable(arrayValue, string(key), fieldTypeName, typeName)
					}
				} else {
					v.traverseVariable(value, string(key), fieldTypeName, typeName)
				}
			})
		}

	case ast.NodeKindEnumTypeDefinition:
		switch jsonValue.Type() {
		case astjson.TypeString:
			usageInfo.EnumValues = []string{string(jsonValue.GetStringBytes())}
		case astjson.TypeArray:
			arr := jsonValue.GetArray()
			usageInfo.EnumValues = make([]string, len(arr))
			for i, arrayValue := range arr {
				usageInfo.EnumValues[i] = string(arrayValue.GetStringBytes())
			}
		}
	}

	v.appendUniqueUsage(usageInfo)
}

func (v *inputUsageInfoVisitor) appendUniqueUsage(info *graphqlmetrics.InputUsageInfo) {
	for _, u := range v.usage {
		if v.infoEquals(u, info) {
			return
		}
	}
	v.usage = append(v.usage, info)
}

func (v *inputUsageInfoVisitor) infoEquals(a, b *graphqlmetrics.InputUsageInfo) bool {
	if a.Count != b.Count {
		return false
	}
	if a.NamedType != b.NamedType {
		return false
	}
	if a.TypeName != b.TypeName {
		return false
	}
	if len(a.Path) != len(b.Path) {
		return false
	}
	for i := range a.Path {
		if a.Path[i] != b.Path[i] {
			return false
		}
	}
	if len(a.EnumValues) != len(b.EnumValues) {
		return false
	}
	for i := range a.EnumValues {
		if a.EnumValues[i] != b.EnumValues[i] {
			return false
		}
	}
	return true
}
