package tsgen

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

type operationRenderer struct {
	schema *ast.Document
}

func (r operationRenderer) renderOperation(op storage.SessionOp) (string, error) {
	if r.schema == nil {
		return "", fmt.Errorf("render op %q: schema is nil", op.Name)
	}

	opDoc, report := astparser.ParseGraphqlDocumentString(op.Body)
	if report.HasErrors() {
		return "", fmt.Errorf("render op %q: parse GraphQL operation: %s", op.Name, report.Error())
	}

	opRef, err := singleOperationRef(&opDoc)
	if err != nil {
		return "", fmt.Errorf("render op %q: %w", op.Name, err)
	}

	varsType, varsOptional, err := r.variablesType(&opDoc, opRef)
	if err != nil {
		return "", fmt.Errorf("render op %q: %w", op.Name, err)
	}

	outputType, err := r.outputType(&opDoc, opRef)
	if err != nil {
		return "", fmt.Errorf("render op %q: %w", op.Name, err)
	}

	return writeFieldSignature(op.Description, op.Name, varsType, outputType, varsOptional), nil
}

func singleOperationRef(doc *ast.Document) (int, error) {
	var refs []int
	for _, node := range doc.RootNodes {
		if node.Kind == ast.NodeKindOperationDefinition {
			refs = append(refs, node.Ref)
		}
	}
	if len(refs) == 0 {
		return 0, fmt.Errorf("operation document contains no operation definition")
	}
	if len(refs) > 1 {
		return 0, fmt.Errorf("operation document contains %d operation definitions", len(refs))
	}
	return refs[0], nil
}

func (r operationRenderer) variablesType(opDoc *ast.Document, opRef int) (string, bool, error) {
	op := opDoc.OperationDefinitions[opRef]
	if !op.HasVariableDefinitions || len(op.VariableDefinitions.Refs) == 0 {
		return "{}", true, nil
	}

	fields := make([]tsProperty, 0, len(op.VariableDefinitions.Refs))
	varsOptional := true
	for _, varRef := range op.VariableDefinitions.Refs {
		name := opDoc.VariableDefinitionNameString(varRef)
		typeRef := opDoc.VariableDefinitionType(varRef)
		required := opDoc.Types[typeRef].TypeKind == ast.TypeKindNonNull

		typ, nullable, err := r.inputType(opDoc, typeRef)
		if err != nil {
			return "", false, err
		}
		if nullable {
			typ = writeNullable(typ)
		} else {
			varsOptional = false
		}

		fields = append(fields, tsProperty{name: name, typ: typ, optional: !required})
	}

	return writeInlineObject(fields), varsOptional, nil
}

func (r operationRenderer) inputType(doc *ast.Document, typeRef int) (string, bool, error) {
	gqlType := doc.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		typ, _, err := r.inputType(doc, gqlType.OfType)
		return typ, false, err
	case ast.TypeKindList:
		item, itemNullable, err := r.inputType(doc, gqlType.OfType)
		if err != nil {
			return "", false, err
		}
		if itemNullable {
			item = writeNullable(item)
		}
		return writeArray(item), true, nil
	case ast.TypeKindNamed:
		typ, err := r.inputNamedType(doc.TypeNameString(typeRef))
		return typ, true, err
	default:
		return "", false, fmt.Errorf("unsupported GraphQL input type kind %s", gqlType.TypeKind.String())
	}
}

func (r operationRenderer) inputNamedType(typeName string) (string, error) {
	switch typeName {
	case "ID", "String":
		return "string", nil
	case "Int", "Float":
		return "number", nil
	case "Boolean":
		return "boolean", nil
	}

	node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
	if !exists {
		return "", fmt.Errorf("missing schema type %q", typeName)
	}

	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		values := r.enumValues(node.Ref)
		return writeStringLiteralUnion(values), nil
	case ast.NodeKindInputObjectTypeDefinition:
		return r.inputObjectType(node.Ref)
	case ast.NodeKindScalarTypeDefinition:
		return "unknown", nil
	default:
		return "unknown", nil
	}
}

func (r operationRenderer) enumValues(enumRef int) []string {
	def := r.schema.EnumTypeDefinitions[enumRef]
	values := make([]string, 0, len(def.EnumValuesDefinition.Refs))
	for _, valueRef := range def.EnumValuesDefinition.Refs {
		values = append(values, r.schema.EnumValueDefinitionNameString(valueRef))
	}
	return values
}

func (r operationRenderer) inputObjectType(inputObjectRef int) (string, error) {
	def := r.schema.InputObjectTypeDefinitions[inputObjectRef]
	fields := make([]tsProperty, 0, len(def.InputFieldsDefinition.Refs))
	for _, fieldRef := range def.InputFieldsDefinition.Refs {
		name := r.schema.InputValueDefinitionNameString(fieldRef)
		typeRef := r.schema.InputValueDefinitionType(fieldRef)
		required := r.schema.Types[typeRef].TypeKind == ast.TypeKindNonNull

		typ, nullable, err := r.inputType(r.schema, typeRef)
		if err != nil {
			return "", err
		}
		if nullable {
			typ = writeNullable(typ)
		}

		fields = append(fields, tsProperty{name: name, typ: typ, optional: !required})
	}

	return writeInlineObject(fields), nil
}

func (r operationRenderer) outputType(opDoc *ast.Document, opRef int) (string, error) {
	op := opDoc.OperationDefinitions[opRef]
	rootNode, err := r.rootOperationNode(op.OperationType)
	if err != nil {
		return "", err
	}

	return r.selectionSetType(opDoc, op.SelectionSet, rootNode)
}

func (r operationRenderer) rootOperationNode(operationType ast.OperationType) (ast.Node, error) {
	var typeName []byte
	switch operationType {
	case ast.OperationTypeQuery:
		typeName = r.schema.Index.QueryTypeName
		if len(typeName) == 0 {
			typeName = []byte("Query")
		}
	case ast.OperationTypeMutation:
		typeName = r.schema.Index.MutationTypeName
		if len(typeName) == 0 {
			typeName = []byte("Mutation")
		}
	case ast.OperationTypeSubscription:
		typeName = r.schema.Index.SubscriptionTypeName
		if len(typeName) == 0 {
			typeName = []byte("Subscription")
		}
	default:
		return ast.Node{}, fmt.Errorf("unsupported operation type %s", operationType.Name())
	}

	node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes(typeName)
	if !exists {
		return ast.Node{}, fmt.Errorf("missing schema root type %q", string(typeName))
	}
	return node, nil
}

func (r operationRenderer) selectionSetType(opDoc *ast.Document, selectionSetRef int, parent ast.Node) (string, error) {
	selections := opDoc.SelectionSets[selectionSetRef]
	fields := make([]tsProperty, 0, len(selections.SelectionRefs))

	for _, selectionRef := range selections.SelectionRefs {
		selection := opDoc.Selections[selectionRef]
		switch selection.Kind {
		case ast.SelectionKindField:
			field, err := r.fieldProperty(opDoc, selection.Ref, parent)
			if err != nil {
				return "", err
			}
			fields = append(fields, field)
		case ast.SelectionKindInlineFragment:
			inlineFields, err := r.inlineFragmentProperties(opDoc, selection.Ref, parent)
			if err != nil {
				return "", err
			}
			fields = append(fields, inlineFields...)
		case ast.SelectionKindFragmentSpread:
			fragmentFields, err := r.fragmentSpreadProperties(opDoc, selection.Ref, parent)
			if err != nil {
				return "", err
			}
			fields = append(fields, fragmentFields...)
		default:
			return "", fmt.Errorf("unsupported selection kind %s", selection.Kind.String())
		}
	}

	return writeInlineObject(fields), nil
}

func (r operationRenderer) fieldProperty(opDoc *ast.Document, fieldRef int, parent ast.Node) (tsProperty, error) {
	name := opDoc.FieldNameString(fieldRef)
	propName := opDoc.FieldAliasOrNameString(fieldRef)

	if name == "__typename" {
		return tsProperty{name: propName, typ: "string"}, nil
	}

	fieldDefRef, exists := r.schema.NodeFieldDefinitionByName(parent, []byte(name))
	if !exists {
		return tsProperty{}, fmt.Errorf("missing field %q on schema type %q", name, parent.NameString(r.schema))
	}

	selectionSetRef := -1
	if opDoc.Fields[fieldRef].HasSelections {
		selectionSetRef = opDoc.Fields[fieldRef].SelectionSet
	}

	typeRef := r.schema.FieldDefinitionType(fieldDefRef)
	typ, nullable, err := r.outputGraphQLType(opDoc, typeRef, selectionSetRef)
	if err != nil {
		return tsProperty{}, err
	}
	if nullable {
		typ = writeNullable(typ)
	}

	return tsProperty{name: propName, typ: typ}, nil
}

func (r operationRenderer) outputGraphQLType(opDoc *ast.Document, typeRef int, selectionSetRef int) (string, bool, error) {
	gqlType := r.schema.Types[typeRef]
	switch gqlType.TypeKind {
	case ast.TypeKindNonNull:
		typ, _, err := r.outputGraphQLType(opDoc, gqlType.OfType, selectionSetRef)
		return typ, false, err
	case ast.TypeKindList:
		item, itemNullable, err := r.outputGraphQLType(opDoc, gqlType.OfType, selectionSetRef)
		if err != nil {
			return "", false, err
		}
		if itemNullable {
			item = writeNullable(item)
		}
		return writeArray(item), true, nil
	case ast.TypeKindNamed:
		typ, err := r.outputNamedType(opDoc, r.schema.TypeNameString(typeRef), selectionSetRef)
		return typ, true, err
	default:
		return "", false, fmt.Errorf("unsupported GraphQL output type kind %s", gqlType.TypeKind.String())
	}
}

func (r operationRenderer) outputNamedType(opDoc *ast.Document, typeName string, selectionSetRef int) (string, error) {
	switch typeName {
	case "ID", "String":
		return "string", nil
	case "Int", "Float":
		return "number", nil
	case "Boolean":
		return "boolean", nil
	}

	node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
	if !exists {
		return "", fmt.Errorf("missing schema type %q", typeName)
	}

	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		return writeStringLiteralUnion(r.enumValues(node.Ref)), nil
	case ast.NodeKindObjectTypeDefinition:
		if selectionSetRef < 0 {
			return "", fmt.Errorf("object type %q requires a selection set", typeName)
		}
		return r.selectionSetType(opDoc, selectionSetRef, node)
	case ast.NodeKindInterfaceTypeDefinition, ast.NodeKindUnionTypeDefinition:
		if selectionSetRef < 0 {
			return "", fmt.Errorf("abstract type %q requires a selection set", typeName)
		}
		return r.abstractFieldType(opDoc, selectionSetRef, node)
	case ast.NodeKindScalarTypeDefinition:
		return "unknown", nil
	default:
		return "unknown", nil
	}
}

func (r operationRenderer) inlineFragmentProperties(opDoc *ast.Document, inlineRef int, parent ast.Node) ([]tsProperty, error) {
	fragment := opDoc.InlineFragments[inlineRef]
	fragmentParent := parent
	if opDoc.InlineFragmentHasTypeCondition(inlineRef) {
		typeName := opDoc.InlineFragmentTypeConditionNameString(inlineRef)
		node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
		if !exists {
			return nil, fmt.Errorf("missing schema type %q", typeName)
		}
		fragmentParent = node
	}

	typ, err := r.selectionSetType(opDoc, fragment.SelectionSet, fragmentParent)
	if err != nil {
		return nil, err
	}

	return propertiesFromInlineObject(typ), nil
}

func (r operationRenderer) fragmentSpreadProperties(opDoc *ast.Document, spreadRef int, parent ast.Node) ([]tsProperty, error) {
	fragmentName := opDoc.FragmentSpreadNameBytes(spreadRef)
	fragmentRef, exists := opDoc.FragmentDefinitionRef(fragmentName)
	if !exists {
		return nil, fmt.Errorf("missing fragment %q", string(fragmentName))
	}

	fragment := opDoc.FragmentDefinitions[fragmentRef]
	fragmentParent := parent
	typeName := opDoc.ResolveTypeNameString(fragment.TypeCondition.Type)
	if typeName != "" {
		node, nodeExists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
		if !nodeExists {
			return nil, fmt.Errorf("missing schema type %q", typeName)
		}
		fragmentParent = node
	}

	typ, err := r.selectionSetType(opDoc, fragment.SelectionSet, fragmentParent)
	if err != nil {
		return nil, err
	}

	return propertiesFromInlineObject(typ), nil
}

func propertiesFromInlineObject(typ string) []tsProperty {
	if typ == "{}" {
		return nil
	}

	inner := typ[2 : len(typ)-2]
	parts := splitInlineObjectFields(inner)
	props := make([]tsProperty, 0, len(parts))
	for _, part := range parts {
		nameAndType := splitProperty(part)
		if nameAndType.name == "" {
			continue
		}
		props = append(props, nameAndType)
	}

	return props
}

func splitInlineObjectFields(inner string) []string {
	var parts []string
	start := 0
	depth := 0
	for i := 0; i < len(inner); i++ {
		switch inner[i] {
		case '{':
			depth++
		case '}':
			depth--
		case ';':
			if depth == 0 && i+1 < len(inner) && inner[i+1] == ' ' {
				parts = append(parts, inner[start:i])
				start = i + 2
			}
		}
	}
	parts = append(parts, inner[start:])
	return parts
}

func splitProperty(part string) tsProperty {
	for i := 0; i < len(part); i++ {
		if part[i] != ':' {
			continue
		}
		optional := i > 0 && part[i-1] == '?'
		nameEnd := i
		if optional {
			nameEnd--
		}
		return tsProperty{name: part[:nameEnd], typ: part[i+2:], optional: optional}
	}
	return tsProperty{}
}

// abstractSelectionSet describes a fragment to be applied to the matching
// branches when lowering an abstract-typed field. `condition` is the schema
// node referenced by the fragment's type condition (or the parent abstract
// node itself for inline fragments without a type condition).
type abstractSelectionSet struct {
	condition       ast.Node
	selectionSetRef int
}

// abstractFieldType lowers a selection set on an interface- or union-typed
// field into a flat discriminated union of branches, one per concrete
// implementor.
func (r operationRenderer) abstractFieldType(opDoc *ast.Document, selectionSetRef int, parent ast.Node) (string, error) {
	parentName := parent.NameString(r.schema)
	possibleNames := r.possibleTypeNames(parent)
	if len(possibleNames) == 0 {
		return "", fmt.Errorf("abstract type %q has no possible types", parentName)
	}
	possibleSet := make(map[string]struct{}, len(possibleNames))
	for _, name := range possibleNames {
		possibleSet[name] = struct{}{}
	}

	selections := opDoc.SelectionSets[selectionSetRef]
	if len(selections.SelectionRefs) == 0 {
		return "", fmt.Errorf("abstract type %q requires at least one selection", parentName)
	}

	// Bucket the selections.
	var bareFieldRefs []int       // Field selections defined on the abstract parent itself
	var typenameSelected bool     // unaliased __typename selected directly
	var fragments []abstractSelectionSet

	for _, selRef := range selections.SelectionRefs {
		sel := opDoc.Selections[selRef]
		switch sel.Kind {
		case ast.SelectionKindField:
			fieldRef := sel.Ref
			fieldName := opDoc.FieldNameString(fieldRef)
			if fieldName == "__typename" {
				if opDoc.FieldAliasOrNameString(fieldRef) == "__typename" {
					typenameSelected = true
				} else {
					// aliased __typename: render through normal field path on each branch
					bareFieldRefs = append(bareFieldRefs, fieldRef)
				}
				continue
			}
			// Non-typename bare field is only valid on interface parents and must
			// be defined on the parent interface.
			if parent.Kind != ast.NodeKindInterfaceTypeDefinition {
				return "", fmt.Errorf("field %q is not valid on union type %q", fieldName, parentName)
			}
			if _, exists := r.schema.NodeFieldDefinitionByName(parent, []byte(fieldName)); !exists {
				return "", fmt.Errorf("missing field %q on interface %q", fieldName, parentName)
			}
			bareFieldRefs = append(bareFieldRefs, fieldRef)
		case ast.SelectionKindInlineFragment:
			inlineRef := sel.Ref
			inline := opDoc.InlineFragments[inlineRef]
			condition := parent
			if opDoc.InlineFragmentHasTypeCondition(inlineRef) {
				typeName := opDoc.InlineFragmentTypeConditionNameString(inlineRef)
				node, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
				if !exists {
					return "", fmt.Errorf("missing schema type %q", typeName)
				}
				condition = node
			}
			if err := r.checkAbstractFragmentCondition(condition, possibleSet, parentName); err != nil {
				return "", err
			}
			fragments = append(fragments, abstractSelectionSet{
				condition:       condition,
				selectionSetRef: inline.SelectionSet,
			})
		case ast.SelectionKindFragmentSpread:
			spreadRef := sel.Ref
			fragmentName := opDoc.FragmentSpreadNameBytes(spreadRef)
			fragRef, exists := opDoc.FragmentDefinitionRef(fragmentName)
			if !exists {
				return "", fmt.Errorf("missing fragment %q", string(fragmentName))
			}
			fragment := opDoc.FragmentDefinitions[fragRef]
			typeName := opDoc.ResolveTypeNameString(fragment.TypeCondition.Type)
			if typeName == "" {
				return "", fmt.Errorf("fragment %q has no type condition", string(fragmentName))
			}
			node, nodeExists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
			if !nodeExists {
				return "", fmt.Errorf("missing schema type %q", typeName)
			}
			if err := r.checkAbstractFragmentCondition(node, possibleSet, parentName); err != nil {
				return "", err
			}
			fragments = append(fragments, abstractSelectionSet{
				condition:       node,
				selectionSetRef: fragment.SelectionSet,
			})
		default:
			return "", fmt.Errorf("unsupported selection kind %s", sel.Kind.String())
		}
	}

	// Build a branch per concrete implementor.
	branches := make([]string, 0, len(possibleNames))
	for _, typeName := range possibleNames {
		concreteNode, exists := r.schema.Index.FirstNonExtensionNodeByNameBytes([]byte(typeName))
		if !exists || concreteNode.Kind != ast.NodeKindObjectTypeDefinition {
			continue
		}

		fields := make([]tsProperty, 0)

		// Bare fields rendered against the concrete type. (For unions there
		// will only be aliased __typename here, since other bare fields are
		// rejected above.)
		for _, fieldRef := range bareFieldRefs {
			prop, err := r.fieldProperty(opDoc, fieldRef, concreteNode)
			if err != nil {
				return "", err
			}
			fields = append(fields, prop)
		}

		// Fragments whose target includes this concrete type.
		for _, frag := range fragments {
			if !abstractFragmentApplies(frag.condition, typeName, possibleSet, r.schema) {
				continue
			}
			fragTyp, err := r.selectionSetType(opDoc, frag.selectionSetRef, concreteNode)
			if err != nil {
				return "", err
			}
			fields = append(fields, propertiesFromInlineObject(fragTyp)...)
		}

		// __typename literal: prepend if explicitly selected.
		if typenameSelected {
			literal := tsProperty{name: "__typename", typ: strconv.Quote(typeName)}
			fields = append([]tsProperty{literal}, fields...)
		}

		// Drop empty branches.
		if len(fields) == 0 {
			continue
		}

		branches = append(branches, writeInlineObject(fields))
	}

	if len(branches) == 0 {
		// Every implementor has zero observable fields. Fall back to a single
		// empty object so the type checker still sees a valid shape.
		return "{}", nil
	}

	if len(branches) == 1 {
		return branches[0], nil
	}

	// Single-shape collapse: every branch identical → one shape.
	allEqual := true
	for i := 1; i < len(branches); i++ {
		if branches[i] != branches[0] {
			allEqual = false
			break
		}
	}
	if allEqual {
		return branches[0], nil
	}

	return strings.Join(branches, " | "), nil
}

// possibleTypeNames returns the concrete object type names that satisfy the
// given abstract parent, in schema declaration order.
func (r operationRenderer) possibleTypeNames(parent ast.Node) []string {
	switch parent.Kind {
	case ast.NodeKindInterfaceTypeDefinition:
		names, _ := r.schema.InterfaceTypeDefinitionImplementedByObjectWithNames(parent.Ref)
		return names
	case ast.NodeKindUnionTypeDefinition:
		names, _ := r.schema.UnionTypeDefinitionMemberTypeNames(parent.Ref)
		return names
	case ast.NodeKindObjectTypeDefinition:
		return []string{r.schema.ObjectTypeDefinitionNameString(parent.Ref)}
	}
	return nil
}

// abstractFragmentApplies decides whether a fragment with the given condition
// applies to the concrete branch named typeName under the parent abstract
// (whose possible types are in parentSet).
func abstractFragmentApplies(condition ast.Node, typeName string, parentSet map[string]struct{}, schema *ast.Document) bool {
	switch condition.Kind {
	case ast.NodeKindObjectTypeDefinition:
		return schema.ObjectTypeDefinitionNameString(condition.Ref) == typeName
	case ast.NodeKindInterfaceTypeDefinition:
		// applies to any T that implements this interface AND is in parentSet.
		impls, _ := schema.InterfaceTypeDefinitionImplementedByObjectWithNames(condition.Ref)
		for _, name := range impls {
			if name == typeName {
				if _, ok := parentSet[name]; ok {
					return true
				}
			}
		}
		return false
	case ast.NodeKindUnionTypeDefinition:
		members, _ := schema.UnionTypeDefinitionMemberTypeNames(condition.Ref)
		for _, name := range members {
			if name == typeName {
				if _, ok := parentSet[name]; ok {
					return true
				}
			}
		}
		return false
	}
	return false
}

// checkAbstractFragmentCondition rejects fragments whose type condition can
// never apply under the given parent abstract.
func (r operationRenderer) checkAbstractFragmentCondition(condition ast.Node, parentSet map[string]struct{}, parentName string) error {
	switch condition.Kind {
	case ast.NodeKindObjectTypeDefinition:
		name := r.schema.ObjectTypeDefinitionNameString(condition.Ref)
		if _, ok := parentSet[name]; !ok {
			return fmt.Errorf("type %q is not a possible type of %q", name, parentName)
		}
	case ast.NodeKindInterfaceTypeDefinition, ast.NodeKindUnionTypeDefinition:
		// abstract conditions are always allowed; their target is the
		// intersection with the parent's possible types (which may be empty
		// — that just means the fragment contributes nothing).
	default:
		return fmt.Errorf("unsupported fragment type condition %s", condition.Kind.String())
	}
	return nil
}
