package tsgen

import (
	"sort"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// schemaSharedTypes returns aliases for every enum and input object defined in
// the schema. Used by DeliveryModeAppend to pre-extract everything before any
// operation is delivered, so subsequent appends can reference them by name
// without retroactive rewrites.
//
// The Scalars config map is consulted when rendering input-object field types
// so that custom scalars resolve consistently with the rest of the bundle.
func schemaSharedTypes(schema *ast.Document, cfg Config) SharedTypes {
	out := SharedTypes{}

	type enumEntry struct {
		name string
		ref  int
	}
	type inputEntry struct {
		name string
		ref  int
	}

	enums := make([]enumEntry, 0, len(schema.EnumTypeDefinitions))
	inputs := make([]inputEntry, 0, len(schema.InputObjectTypeDefinitions))

	for _, rn := range schema.RootNodes {
		switch rn.Kind {
		case ast.NodeKindEnumTypeDefinition:
			name := schema.EnumTypeDefinitionNameString(rn.Ref)
			if isInternalTypeName(name) {
				continue
			}
			enums = append(enums, enumEntry{name, rn.Ref})
		case ast.NodeKindInputObjectTypeDefinition:
			name := schema.InputObjectTypeDefinitionNameString(rn.Ref)
			if isInternalTypeName(name) {
				continue
			}
			inputs = append(inputs, inputEntry{name, rn.Ref})
		}
	}

	sort.SliceStable(enums, func(i, j int) bool { return enums[i].name < enums[j].name })
	sort.SliceStable(inputs, func(i, j int) bool { return inputs[i].name < inputs[j].name })

	for _, e := range enums {
		out.Add(SharedType{
			Name: e.name,
			TS:   enumLiteralUnion(schema, e.ref),
			Kind: SharedTypeEnum,
		})
	}

	// Build input-object aliases against a registry that already contains the
	// enums plus any inputs added so far so cross-references resolve by name.
	for _, in := range inputs {
		// Use a temporary signatureBuilder to render the body so nested refs
		// pick up the aliases already in `out`.
		b := &signatureBuilder{schema: schema, doc: schema, cfg: cfg, known: out}
		body := b.inputObjectShape(in.ref)
		out.Add(SharedType{
			Name: in.name,
			TS:   body,
			Kind: SharedTypeInputObject,
		})
	}

	return out
}

// isInternalTypeName filters introspection and base-schema additions that
// shouldn't appear in the bundle.
func isInternalTypeName(name string) bool {
	if len(name) >= 2 && name[0] == '_' && name[1] == '_' {
		return true
	}
	switch name {
	case "Boolean", "Int", "Float", "String", "ID":
		return true
	}
	return false
}

// extractReusedTypes scans operations for enums and input objects that appear
// in two or more operations, and returns a registry of those plus any types
// already in `seed`.
func extractReusedTypes(ops []Operation, schema *ast.Document, seed SharedTypes, cfg Config) SharedTypes {
	type counter struct {
		count int
		ref   int
		kind  SharedTypeKind
	}
	usage := make(map[string]*counter)

	addUsage := func(name string, kind SharedTypeKind, ref int) {
		c, ok := usage[name]
		if !ok {
			c = &counter{ref: ref, kind: kind}
			usage[name] = c
		}
		c.count++
	}

	for _, op := range ops {
		seen := make(map[string]bool)
		opDef := op.Doc.OperationDefinitions[op.OpRef]
		for _, vRef := range opDef.VariableDefinitions.Refs {
			vd := op.Doc.VariableDefinitions[vRef]
			collectInputTypeNames(op.Doc, vd.Type, schema, seen)
		}
		for name := range seen {
			node, ok := schema.Index.FirstNodeByNameStr(name)
			if !ok {
				continue
			}
			switch node.Kind {
			case ast.NodeKindEnumTypeDefinition:
				addUsage(name, SharedTypeEnum, node.Ref)
			case ast.NodeKindInputObjectTypeDefinition:
				addUsage(name, SharedTypeInputObject, node.Ref)
			}
		}
	}

	out := seed.clone()

	// Sort names so output is deterministic.
	names := make([]string, 0, len(usage))
	for n, c := range usage {
		if c.count >= 2 {
			names = append(names, n)
		}
	}
	sort.Strings(names)

	// Two passes: enums first, then input objects (since inputs can reference
	// enums and inputs by name).
	for _, n := range names {
		c := usage[n]
		if c.kind != SharedTypeEnum {
			continue
		}
		if out.Has(n) {
			continue
		}
		out.Add(SharedType{
			Name: n,
			TS:   enumLiteralUnion(schema, c.ref),
			Kind: SharedTypeEnum,
		})
	}
	for _, n := range names {
		c := usage[n]
		if c.kind != SharedTypeInputObject {
			continue
		}
		if out.Has(n) {
			continue
		}
		b := &signatureBuilder{schema: schema, doc: schema, cfg: cfg, known: out}
		body := b.inputObjectShape(c.ref)
		out.Add(SharedType{
			Name: n,
			TS:   body,
			Kind: SharedTypeInputObject,
		})
	}

	return out
}

// collectInputTypeNames walks an input type chain and records every named
// (non-scalar, non-builtin) type encountered. Recurses into input objects.
func collectInputTypeNames(doc *ast.Document, typeRef int, schema *ast.Document, out map[string]bool) {
	namedRef := doc.ResolveUnderlyingType(typeRef)
	name := doc.Input.ByteSliceString(doc.Types[namedRef].Name)
	if isInternalTypeName(name) {
		return
	}
	if out[name] {
		return
	}
	node, ok := schema.Index.FirstNodeByNameStr(name)
	if !ok {
		return
	}
	switch node.Kind {
	case ast.NodeKindEnumTypeDefinition:
		out[name] = true
	case ast.NodeKindInputObjectTypeDefinition:
		out[name] = true
		def := schema.InputObjectTypeDefinitions[node.Ref]
		for _, ivRef := range def.InputFieldsDefinition.Refs {
			iv := schema.InputValueDefinitions[ivRef]
			collectInputTypeNames(schema, iv.Type, schema, out)
		}
	}
}
