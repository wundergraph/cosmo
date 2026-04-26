package tsgen

import (
	"fmt"
	"sort"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

// signatureBuilder owns all state for emitting one operation's TS entry.
type signatureBuilder struct {
	op     Operation
	doc    *ast.Document
	schema *ast.Document
	cfg    Config
	known  SharedTypes
	used   SharedTypes

	// requirePaths captures dotted paths annotated with @require during
	// emission. Stored so callers can persist them alongside the signature.
	requirePaths []string
	// path is the in-progress dotted path used while walking the selection set.
	path []string
}

func newSignatureBuilder(op Operation, schema *ast.Document, known SharedTypes, cfg Config) *signatureBuilder {
	return &signatureBuilder{
		op:     op,
		doc:    op.Doc,
		schema: schema,
		cfg:    cfg,
		known:  known,
	}
}

// build produces the final entry text and the registry of shared types it
// references.
func (b *signatureBuilder) build() (string, SharedTypes, error) {
	vars, err := b.emitVars()
	if err != nil {
		return "", SharedTypes{}, err
	}
	data, err := b.emitData()
	if err != nil {
		return "", SharedTypes{}, err
	}
	entry := "{ vars: " + vars + "; data: " + data + " }"
	return entry, b.used, nil
}

// markUsed records that the entry references a shared alias.
func (b *signatureBuilder) markUsed(name string) {
	if t, ok := b.known.Get(name); ok {
		b.used.Add(t)
	}
}

// RequiredPaths returns the dotted paths annotated with @require in the
// selection set. Available after build() has been called.
func (b *signatureBuilder) RequiredPaths() []string {
	out := make([]string, len(b.requirePaths))
	copy(out, b.requirePaths)
	return out
}

// emitVars renders the operation's variable definitions as a TS object literal.
// Required fields come before optional ones (§5 rule 6).
func (b *signatureBuilder) emitVars() (string, error) {
	opDef := b.doc.OperationDefinitions[b.op.OpRef]
	if !opDef.HasVariableDefinitions || len(opDef.VariableDefinitions.Refs) == 0 {
		return "{}", nil
	}

	type entry struct {
		name     string
		ts       string
		optional bool
	}
	refs := opDef.VariableDefinitions.Refs
	entries := make([]entry, 0, len(refs))

	for _, vRef := range refs {
		vd := b.doc.VariableDefinitions[vRef]
		name := b.doc.VariableValueNameString(vd.VariableValue.Ref)
		nonNull := b.doc.TypeIsNonNull(vd.Type)
		hasDefault := vd.DefaultValue.IsDefined
		// A default value fills in the absent case, so the agent never has to
		// pass null. Drop ` | null` from the TS rendering when a default is set.
		ts := b.mapInputTypeWithDefault(b.doc, vd.Type, hasDefault)
		optional := !nonNull || hasDefault
		entries = append(entries, entry{name, ts, optional})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return !entries[i].optional && entries[j].optional
	})

	var sb strings.Builder
	sb.WriteString("{ ")
	for i, e := range entries {
		if i > 0 {
			sb.WriteString("; ")
		}
		sb.WriteString(e.name)
		if e.optional {
			sb.WriteByte('?')
		}
		sb.WriteString(": ")
		sb.WriteString(e.ts)
	}
	sb.WriteString(" }")
	return sb.String(), nil
}

// emitData walks the operation's top-level selection set and returns its TS
// shape.
func (b *signatureBuilder) emitData() (string, error) {
	opDef := b.doc.OperationDefinitions[b.op.OpRef]
	if !opDef.HasSelections {
		return "{}", nil
	}
	rootNode, err := b.rootTypeNode()
	if err != nil {
		return "", err
	}
	return b.emitSelectionSetObject(opDef.SelectionSet, rootNode)
}

// rootTypeNode returns the schema Node for Query/Mutation/Subscription based
// on the operation kind.
func (b *signatureBuilder) rootTypeNode() (ast.Node, error) {
	var name []byte
	switch b.op.Kind {
	case ast.OperationTypeQuery:
		name = b.schema.Index.QueryTypeName
		if len(name) == 0 {
			name = []byte("Query")
		}
	case ast.OperationTypeMutation:
		name = b.schema.Index.MutationTypeName
		if len(name) == 0 {
			name = []byte("Mutation")
		}
	case ast.OperationTypeSubscription:
		name = b.schema.Index.SubscriptionTypeName
		if len(name) == 0 {
			name = []byte("Subscription")
		}
	default:
		return ast.InvalidNode, fmt.Errorf("%w: unknown operation kind %d", ErrInvalidOperation, b.op.Kind)
	}
	node, ok := b.schema.Index.FirstNodeByNameBytes(name)
	if !ok {
		return ast.InvalidNode, fmt.Errorf("%w: root type %q not in schema", ErrInvalidOperation, string(name))
	}
	return node, nil
}

// emitSelectionSetObject emits the TS object shape for a selection set whose
// enclosing type is a concrete object/interface (not an abstract type that
// branches into inline fragments).
func (b *signatureBuilder) emitSelectionSetObject(selectionSetRef int, enclosing ast.Node) (string, error) {
	if isAbstract(enclosing) {
		return b.emitAbstractSelectionSet(selectionSetRef, enclosing)
	}

	selSet := b.doc.SelectionSets[selectionSetRef]
	pieces := make([]string, 0, len(selSet.SelectionRefs))

	for _, selRef := range selSet.SelectionRefs {
		sel := b.doc.Selections[selRef]
		switch sel.Kind {
		case ast.SelectionKindField:
			fieldRef := sel.Ref
			ts, name, err := b.emitField(fieldRef, enclosing)
			if err != nil {
				return "", err
			}
			pieces = append(pieces, name+": "+ts)
		case ast.SelectionKindInlineFragment:
			// Inline fragment on a concrete type (rare): inline its selections.
			frag := b.doc.InlineFragments[sel.Ref]
			if !frag.HasSelections {
				continue
			}
			inner, err := b.emitSelectionSetObject(frag.SelectionSet, enclosing)
			if err != nil {
				return "", err
			}
			// Strip the surrounding braces and merge the inner fields in.
			pieces = append(pieces, stripBraces(inner)...)
		case ast.SelectionKindFragmentSpread:
			// A fragment spread that survived normalization. Inline it.
			spreadRef := sel.Ref
			fragName := b.doc.FragmentSpreadNameString(spreadRef)
			fragDefRef, ok := b.doc.FragmentDefinitionRef([]byte(fragName))
			if !ok {
				return "", fmt.Errorf("%w: fragment %q not found", ErrInvalidOperation, fragName)
			}
			fragSelSet := b.doc.FragmentDefinitions[fragDefRef].SelectionSet
			inner, err := b.emitSelectionSetObject(fragSelSet, enclosing)
			if err != nil {
				return "", err
			}
			pieces = append(pieces, stripBraces(inner)...)
		}
	}

	pieces = dedupeFields(pieces)

	if len(pieces) == 0 {
		return "{}", nil
	}
	return "{ " + strings.Join(pieces, "; ") + " }", nil
}

// emitAbstractSelectionSet emits the discriminated union for a selection set
// whose enclosing type is an interface or union.
func (b *signatureBuilder) emitAbstractSelectionSet(selectionSetRef int, enclosing ast.Node) (string, error) {
	selSet := b.doc.SelectionSets[selectionSetRef]
	// Common selections that apply to every concrete branch (e.g. fields
	// declared on the interface).
	type branch struct {
		typeName string
		pieces   []string
	}
	var sharedPieces []string
	branches := make([]branch, 0)

	addToBranch := func(typeName string, pieces []string) {
		for i := range branches {
			if branches[i].typeName == typeName {
				branches[i].pieces = append(branches[i].pieces, pieces...)
				return
			}
		}
		branches = append(branches, branch{typeName: typeName, pieces: append([]string(nil), pieces...)})
	}

	for _, selRef := range selSet.SelectionRefs {
		sel := b.doc.Selections[selRef]
		switch sel.Kind {
		case ast.SelectionKindField:
			fieldRef := sel.Ref
			ts, name, err := b.emitField(fieldRef, enclosing)
			if err != nil {
				return "", err
			}
			sharedPieces = append(sharedPieces, name+": "+ts)
		case ast.SelectionKindInlineFragment:
			frag := b.doc.InlineFragments[sel.Ref]
			typeName := b.doc.InlineFragmentTypeConditionNameString(sel.Ref)
			if typeName == "" {
				continue
			}
			condNode, ok := b.schema.Index.FirstNodeByNameStr(typeName)
			if !ok {
				return "", fmt.Errorf("%w: type condition %q not in schema", ErrInvalidOperation, typeName)
			}
			if !frag.HasSelections {
				continue
			}
			inner, err := b.emitSelectionSetObject(frag.SelectionSet, condNode)
			if err != nil {
				return "", err
			}
			addToBranch(typeName, stripBraces(inner))
		case ast.SelectionKindFragmentSpread:
			fragName := b.doc.FragmentSpreadNameString(sel.Ref)
			fragDefRef, ok := b.doc.FragmentDefinitionRef([]byte(fragName))
			if !ok {
				return "", fmt.Errorf("%w: fragment %q not found", ErrInvalidOperation, fragName)
			}
			fragDef := b.doc.FragmentDefinitions[fragDefRef]
			typeName := b.doc.FragmentDefinitionTypeName(fragDefRef)
			condNode, ok := b.schema.Index.FirstNodeByNameBytes(typeName)
			if !ok {
				return "", fmt.Errorf("%w: type condition %q not in schema", ErrInvalidOperation, string(typeName))
			}
			inner, err := b.emitSelectionSetObject(fragDef.SelectionSet, condNode)
			if err != nil {
				return "", err
			}
			addToBranch(string(typeName), stripBraces(inner))
		}
	}

	// Resolve concrete branches: the union/interface implementer set determines
	// which branches need to appear. If branches were specified explicitly,
	// honor those; otherwise enumerate implementers and emit one branch per
	// concrete type that carries only the shared pieces.
	concreteTypes := b.concreteImplementers(enclosing)
	branchNames := make([]string, 0, len(concreteTypes))
	for _, t := range concreteTypes {
		branchNames = append(branchNames, t)
	}
	if len(branches) > 0 {
		// Use the explicit branches' order, restricted to ones the schema
		// actually has.
		branchNames = branchNames[:0]
		for _, br := range branches {
			branchNames = append(branchNames, br.typeName)
		}
	}

	if len(branchNames) == 0 {
		// Degenerate: no implementers known. Emit object shape with shared
		// pieces only.
		if len(sharedPieces) == 0 {
			return "{}", nil
		}
		return "{ " + strings.Join(sharedPieces, "; ") + " }", nil
	}

	parts := make([]string, 0, len(branchNames))
	for _, name := range branchNames {
		typenameLit := `__typename: "` + name + `"`
		var bp []string
		for _, br := range branches {
			if br.typeName == name {
				bp = br.pieces
				break
			}
		}
		// Strip any pre-existing __typename to avoid duplication; we always
		// emit the literal form.
		bp = stripTypename(bp)
		shared := stripTypename(append([]string(nil), sharedPieces...))
		merged := []string{typenameLit}
		merged = append(merged, shared...)
		merged = append(merged, bp...)
		merged = dedupeFields(merged)
		parts = append(parts, "{ "+strings.Join(merged, "; ")+" }")
	}

	if len(parts) == 1 {
		return parts[0], nil
	}
	return "(" + strings.Join(parts, " | ") + ")", nil
}

// emitField emits the TS for a single field selection. Returns the rendered
// type and the TS property key (alias if present, field name otherwise).
func (b *signatureBuilder) emitField(fieldRef int, enclosing ast.Node) (string, string, error) {
	field := b.doc.Fields[fieldRef]
	key := b.doc.FieldAliasOrNameString(fieldRef)
	rawName := b.doc.FieldNameString(fieldRef)

	// Built-in __typename selection: emit literal type when on a concrete type;
	// the abstract handler emits the discriminator on its own.
	if rawName == "__typename" {
		typename := b.schema.NodeNameString(enclosing)
		if isAbstract(enclosing) {
			return "string", key, nil
		}
		return `"` + typename + `"`, key, nil
	}

	fieldDefRef, ok := b.schema.NodeFieldDefinitionByName(enclosing, []byte(rawName))
	if !ok {
		return "", "", fmt.Errorf("%w: field %q not on type %s",
			ErrInvalidOperation, rawName, b.schema.NodeNameString(enclosing))
	}

	fieldType := b.schema.FieldDefinitions[fieldDefRef].Type
	requireOverride := b.fieldHasRequire(fieldRef)

	b.path = append(b.path, key)
	defer func() { b.path = b.path[:len(b.path)-1] }()

	if requireOverride {
		b.requirePaths = append(b.requirePaths, strings.Join(b.path, "."))
	}

	if !field.HasSelections {
		// Leaf field: scalar/enum.
		typeName := b.schema.ResolveTypeNameString(fieldType)
		inner := b.mapNamedType(typeName)
		return wrapType(inner, b.schema, fieldType, requireOverride), key, nil
	}

	// Composite field: recurse.
	innerNode := b.fieldTypeNode(fieldDefRef)
	innerObject, err := b.emitSelectionSetObject(field.SelectionSet, innerNode)
	if err != nil {
		return "", "", err
	}
	return wrapType(innerObject, b.schema, fieldType, requireOverride), key, nil
}

// fieldTypeNode resolves the named type of a field definition into a schema
// Node (object, interface, or union).
func (b *signatureBuilder) fieldTypeNode(fieldDefRef int) ast.Node {
	typeName := b.schema.FieldDefinitionTypeNameBytes(fieldDefRef)
	node, _ := b.schema.Index.FirstNodeByNameBytes(typeName)
	return node
}

// concreteImplementers returns the concrete object type names that implement
// the given interface or are members of the given union. Order is schema order.
func (b *signatureBuilder) concreteImplementers(node ast.Node) []string {
	switch node.Kind {
	case ast.NodeKindUnionTypeDefinition:
		def := b.schema.UnionTypeDefinitions[node.Ref]
		if !def.HasUnionMemberTypes {
			return nil
		}
		out := make([]string, 0, len(def.UnionMemberTypes.Refs))
		for _, tRef := range def.UnionMemberTypes.Refs {
			out = append(out, b.schema.TypeNameString(tRef))
		}
		return out
	case ast.NodeKindInterfaceTypeDefinition:
		objs, ok := b.schema.InterfaceTypeDefinitionImplementedByObjectWithNames(node.Ref)
		if !ok {
			return nil
		}
		return objs
	}
	return nil
}

// fieldHasRequire reports whether the given field selection carries the
// @require directive.
func (b *signatureBuilder) fieldHasRequire(fieldRef int) bool {
	f := b.doc.Fields[fieldRef]
	if !f.HasDirectives {
		return false
	}
	for _, dRef := range f.Directives.Refs {
		if b.doc.DirectiveNameString(dRef) == "require" {
			return true
		}
	}
	return false
}

// isAbstract reports whether the schema node is an interface or union.
func isAbstract(node ast.Node) bool {
	return node.Kind == ast.NodeKindInterfaceTypeDefinition ||
		node.Kind == ast.NodeKindUnionTypeDefinition
}

// stripBraces takes a TS object literal and returns its semicolon-separated
// piece list (no surrounding braces).
func stripBraces(s string) []string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "{") || !strings.HasSuffix(s, "}") {
		return []string{s}
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return nil
	}
	return splitTopLevel(inner, ';')
}

// splitTopLevel splits a string on the given separator at depth 0 (not inside
// braces, brackets, or parentheses). Whitespace around pieces is trimmed.
func splitTopLevel(s string, sep byte) []string {
	var out []string
	depth := 0
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{', '[', '(':
			depth++
		case '}', ']', ')':
			depth--
		case sep:
			if depth == 0 {
				out = append(out, strings.TrimSpace(s[start:i]))
				start = i + 1
			}
		}
	}
	if start < len(s) {
		piece := strings.TrimSpace(s[start:])
		if piece != "" {
			out = append(out, piece)
		}
	}
	return out
}

// dedupeFields removes pieces with duplicate leading keys, keeping the first.
func dedupeFields(pieces []string) []string {
	seen := make(map[string]bool, len(pieces))
	out := pieces[:0]
	for _, p := range pieces {
		key := pieceKey(p)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out
}

func stripTypename(pieces []string) []string {
	out := pieces[:0]
	for _, p := range pieces {
		if pieceKey(p) == "__typename" {
			continue
		}
		out = append(out, p)
	}
	return out
}

func pieceKey(piece string) string {
	idx := strings.IndexAny(piece, ":?")
	if idx < 0 {
		return piece
	}
	return strings.TrimSpace(piece[:idx])
}
