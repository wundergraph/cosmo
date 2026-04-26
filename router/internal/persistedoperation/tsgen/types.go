package tsgen

import (
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// nullSuffix is appended to nullable TypeScript types.
const nullSuffix = " | null"

// scalarTSType returns the TS type for a named GraphQL type that is either a
// built-in scalar or a custom scalar (mapped via cfg.Scalars). Returns the
// empty string if the name is not a scalar.
func scalarTSType(name string, cfg Config) (string, bool) {
	if ts, ok := cfg.Scalars[name]; ok {
		return ts, true
	}
	switch name {
	case "String", "ID":
		return "string", true
	case "Int", "Float":
		return "number", true
	case "Boolean":
		return "boolean", true
	}
	return "", false
}

// wrapType produces TS wrapping (lists, nullability) around an inner TS type
// according to the GraphQL type chain rooted at typeRef in `doc`.
//
// requireOverride forces the outermost level to be non-null (used by `@require`).
func wrapType(inner string, doc *ast.Document, typeRef int, requireOverride bool) string {
	out := wrapTypeRec(inner, doc, typeRef)
	if requireOverride {
		out = strings.TrimSuffix(out, nullSuffix)
	}
	return out
}

func wrapTypeRec(inner string, doc *ast.Document, typeRef int) string {
	t := doc.Types[typeRef]
	switch t.TypeKind {
	case ast.TypeKindNamed:
		return inner + nullSuffix
	case ast.TypeKindNonNull:
		child := doc.Types[t.OfType]
		switch child.TypeKind {
		case ast.TypeKindNamed:
			return inner
		case ast.TypeKindList:
			elem := wrapTypeRec(inner, doc, child.OfType)
			return wrapListElement(elem) + "[]"
		}
	case ast.TypeKindList:
		elem := wrapTypeRec(inner, doc, t.OfType)
		return wrapListElement(elem) + "[]" + nullSuffix
	}
	return "unknown"
}

// wrapListElement wraps an element type in parentheses only when the trailing
// `[]` would otherwise bind incorrectly. Object literals like `{ ... }` parse
// unambiguously without parens; only top-level `|` unions need them.
func wrapListElement(elem string) string {
	if containsTopLevelPipe(elem) {
		return "(" + elem + ")"
	}
	return elem
}

func containsTopLevelPipe(s string) bool {
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{', '[', '(':
			depth++
		case '}', ']', ')':
			depth--
		case '|':
			if depth == 0 {
				return true
			}
		}
	}
	return false
}

// mapNamedType maps a GraphQL named type (without wrappers) to its TS form.
// Side effects: enums and input objects encountered may be appended to `b.used`
// as the entry is built.
func (b *signatureBuilder) mapNamedType(name string) string {
	if ts, ok := scalarTSType(name, b.cfg); ok {
		return ts
	}

	node, found := b.schema.Index.FirstNodeByNameStr(name)
	if !found {
		// Custom scalar without a mapping. Default to string.
		return "string"
	}
	switch node.Kind {
	case ast.NodeKindScalarTypeDefinition:
		return "string"
	case ast.NodeKindEnumTypeDefinition:
		return b.refEnum(name, node.Ref)
	case ast.NodeKindInputObjectTypeDefinition:
		return b.refInputObject(name, node.Ref)
	case ast.NodeKindObjectTypeDefinition,
		ast.NodeKindInterfaceTypeDefinition,
		ast.NodeKindUnionTypeDefinition:
		// Output types should never appear as variable types or as named TS
		// targets when emitting input shapes. The schema validation should
		// reject this earlier; emit `unknown` defensively.
		return "unknown"
	}
	return "unknown"
}

// refEnum returns either the enum's literal-union form (when inlined) or its
// shared-alias name (when extracted).
func (b *signatureBuilder) refEnum(name string, defRef int) string {
	if b.known.Has(name) {
		b.markUsed(name)
		return name
	}
	return enumLiteralUnion(b.schema, defRef)
}

// refInputObject returns either the input object's inline shape or its shared
// alias name.
func (b *signatureBuilder) refInputObject(name string, defRef int) string {
	if b.known.Has(name) {
		b.markUsed(name)
		return name
	}
	return b.inputObjectShape(defRef)
}

// enumLiteralUnion returns the literal-union form for an enum type, e.g.
// `"A"|"B"|"C"`.
func enumLiteralUnion(schema *ast.Document, defRef int) string {
	def := schema.EnumTypeDefinitions[defRef]
	refs := def.EnumValuesDefinition.Refs
	if len(refs) == 0 {
		return "never"
	}
	var sb strings.Builder
	for i, vRef := range refs {
		if i > 0 {
			sb.WriteByte('|')
		}
		sb.WriteByte('"')
		sb.WriteString(schema.EnumValueDefinitionNameString(vRef))
		sb.WriteByte('"')
	}
	return sb.String()
}

// inputObjectShape returns the TS object shape for a GraphQL input object
// definition. Recursively inlines nested input objects (subject to known/
// extraction overrides handled by mapNamedType).
func (b *signatureBuilder) inputObjectShape(defRef int) string {
	def := b.schema.InputObjectTypeDefinitions[defRef]
	refs := def.InputFieldsDefinition.Refs
	if len(refs) == 0 {
		return "{}"
	}
	var sb strings.Builder
	sb.WriteString("{ ")
	for i, ivRef := range refs {
		if i > 0 {
			sb.WriteString("; ")
		}
		iv := b.schema.InputValueDefinitions[ivRef]
		nameBytes := b.schema.Input.ByteSlice(iv.Name)
		nonNull := b.schema.TypeIsNonNull(iv.Type)
		hasDefault := iv.DefaultValue.IsDefined
		optional := !nonNull || hasDefault
		sb.Write(nameBytes)
		if optional {
			sb.WriteByte('?')
		}
		sb.WriteString(": ")
		sb.WriteString(b.mapInputType(b.schema, iv.Type))
	}
	sb.WriteString(" }")
	return sb.String()
}

// mapInputType walks an input type chain (variables and input-object fields)
// and produces its TS rendering.
func (b *signatureBuilder) mapInputType(doc *ast.Document, typeRef int) string {
	return b.mapInputTypeWithDefault(doc, typeRef, false)
}

// mapInputTypeWithDefault is like mapInputType, but drops the outermost
// nullability when the variable has a default value. Inner list/named null
// markers stay intact.
func (b *signatureBuilder) mapInputTypeWithDefault(doc *ast.Document, typeRef int, hasDefault bool) string {
	namedRef := doc.ResolveUnderlyingType(typeRef)
	name := doc.Input.ByteSliceString(doc.Types[namedRef].Name)
	inner := b.mapNamedType(name)
	return wrapType(inner, doc, typeRef, hasDefault)
}
