package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/formatter"
)

// Generator projects an *ast.Schema onto a file tree rooted at Root.
//
// Layout:
//
//	schema.graphql              full SDL
//	README.txt                  how to navigate this tree
//	index.txt                   counts + the root entry points
//	query/<field>.graphql       one file per root Query field (entry points)
//	mutation/<field>.graphql    one file per root Mutation field
//	subscription/<field>.graphql
//	directives/<name>.txt
//	types/<Name>/
//	    type.graphql            the type's own SDL block
//	    meta.txt                kind, description, summary
//	    fields/<field>.graphql  (objects & interfaces) field signature + args + docs
//	    input_fields/<field>.graphql (input objects)
//	    values/<value>.txt      (enums)
//	    references/<field> ->    symlink to the field's return type dir (graph edge)
//	    implements/<iface> ->    symlink (objects) to interfaces they implement
//	    implemented_by/<obj> ->  symlink (interfaces) to implementing objects
//	    possible_types/<obj> ->  symlink (unions) to member types
type Generator struct {
	Root   string
	Schema *ast.Schema
	SDL    string
}

func (g *Generator) Generate() error {
	if err := os.WriteFile(filepath.Join(g.Root, "schema.graphql"), []byte(g.SDL), 0o644); err != nil {
		return err
	}

	typesDir := filepath.Join(g.Root, "types")
	if err := os.MkdirAll(typesDir, 0o755); err != nil {
		return err
	}

	counts := map[ast.DefinitionKind]int{}
	var names []string
	for _, def := range g.Schema.Types {
		if isInternal(def.Name) {
			continue
		}
		if err := g.writeType(typesDir, def); err != nil {
			return fmt.Errorf("type %s: %w", def.Name, err)
		}
		counts[def.Kind]++
		names = append(names, def.Name)
	}

	if err := g.writeRootEntryPoints(); err != nil {
		return err
	}
	if err := g.writeDirectives(); err != nil {
		return err
	}
	if err := g.writeIndex(counts, names); err != nil {
		return err
	}
	return g.writeReadme()
}

// writeType emits the directory for a single named type.
func (g *Generator) writeType(base string, def *ast.Definition) error {
	dir := filepath.Join(base, def.Name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	if err := os.WriteFile(filepath.Join(dir, "type.graphql"), []byte(formatDefinition(def)), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "meta.txt"), []byte(g.renderMeta(def)), 0o644); err != nil {
		return err
	}

	switch def.Kind {
	case ast.Object, ast.Interface:
		if err := g.writeFields(dir, def, "fields"); err != nil {
			return err
		}
	case ast.InputObject:
		if err := g.writeFields(dir, def, "input_fields"); err != nil {
			return err
		}
	case ast.Enum:
		valDir := filepath.Join(dir, "values")
		if err := os.MkdirAll(valDir, 0o755); err != nil {
			return err
		}
		for _, v := range def.EnumValues {
			body := v.Name + "\n"
			if v.Description != "" {
				body += "\n" + v.Description + "\n"
			}
			if dep := v.Directives.ForName("deprecated"); dep != nil {
				body += "\nDeprecated: " + directiveReason(dep) + "\n"
			}
			if err := os.WriteFile(filepath.Join(valDir, safeName(v.Name)+".txt"), []byte(body), 0o644); err != nil {
				return err
			}
		}
	}

	// Graph edges as symlinks.
	if def.Kind == ast.Object && len(def.Interfaces) > 0 {
		if err := g.symlinkSiblings(dir, "implements", def.Interfaces); err != nil {
			return err
		}
	}
	if def.Kind == ast.Interface {
		var impls []string
		for _, t := range g.Schema.PossibleTypes[def.Name] {
			impls = append(impls, t.Name)
		}
		sort.Strings(impls)
		if err := g.symlinkSiblings(dir, "implemented_by", impls); err != nil {
			return err
		}
	}
	if def.Kind == ast.Union {
		if err := g.symlinkSiblings(dir, "possible_types", def.Types); err != nil {
			return err
		}
	}
	return nil
}

// writeFields writes one file per field plus a references/ dir of symlinks to
// each field's underlying return type directory.
func (g *Generator) writeFields(typeDir string, def *ast.Definition, subdir string) error {
	fieldsDir := filepath.Join(typeDir, subdir)
	if err := os.MkdirAll(fieldsDir, 0o755); err != nil {
		return err
	}
	var refs []refLink
	for _, f := range def.Fields {
		if isInternal(f.Name) {
			continue
		}
		if err := os.WriteFile(filepath.Join(fieldsDir, safeName(f.Name)+".graphql"), []byte(g.renderField(def, f)), 0o644); err != nil {
			return err
		}
		if bt := baseType(f.Type); g.namedTypeExists(bt) {
			refs = append(refs, refLink{field: f.Name, target: bt})
		}
	}
	if len(refs) == 0 {
		return nil
	}
	refsDir := filepath.Join(typeDir, "references")
	if err := os.MkdirAll(refsDir, 0o755); err != nil {
		return err
	}
	for _, r := range refs {
		// references/<field> -> ../../<TargetType>
		_ = os.Symlink(filepath.Join("..", "..", r.target), filepath.Join(refsDir, safeName(r.field)))
	}
	return nil
}

type refLink struct{ field, target string }

// symlinkSiblings creates dir/<name> -> ../../<name> for each target type.
func (g *Generator) symlinkSiblings(typeDir, sub string, targets []string) error {
	if len(targets) == 0 {
		return nil
	}
	d := filepath.Join(typeDir, sub)
	if err := os.MkdirAll(d, 0o755); err != nil {
		return err
	}
	for _, t := range targets {
		if !g.namedTypeExists(t) {
			continue
		}
		_ = os.Symlink(filepath.Join("..", "..", t), filepath.Join(d, safeName(t)))
	}
	return nil
}

func (g *Generator) writeRootEntryPoints() error {
	roots := []struct {
		dir string
		def *ast.Definition
	}{
		{"query", g.Schema.Query},
		{"mutation", g.Schema.Mutation},
		{"subscription", g.Schema.Subscription},
	}
	for _, r := range roots {
		if r.def == nil {
			continue
		}
		dir := filepath.Join(g.Root, r.dir)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		for _, f := range r.def.Fields {
			if isInternal(f.Name) {
				continue
			}
			if err := os.WriteFile(filepath.Join(dir, safeName(f.Name)+".graphql"), []byte(g.renderField(r.def, f)), 0o644); err != nil {
				return err
			}
		}
	}
	return nil
}

func (g *Generator) writeDirectives() error {
	if len(g.Schema.Directives) == 0 {
		return nil
	}
	dir := filepath.Join(g.Root, "directives")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for name, d := range g.Schema.Directives {
		if isInternal(name) {
			continue
		}
		var b strings.Builder
		fmt.Fprintf(&b, "directive @%s\n", d.Name)
		if d.Description != "" {
			fmt.Fprintf(&b, "\n%s\n", d.Description)
		}
		if len(d.Arguments) > 0 {
			b.WriteString("\nArguments:\n")
			for _, a := range d.Arguments {
				fmt.Fprintf(&b, "  %s: %s\n", a.Name, a.Type.String())
			}
		}
		if len(d.Locations) > 0 {
			locs := make([]string, len(d.Locations))
			for i, l := range d.Locations {
				locs[i] = string(l)
			}
			fmt.Fprintf(&b, "\nLocations: %s\n", strings.Join(locs, " | "))
		}
		if err := os.WriteFile(filepath.Join(dir, safeName(name)+".txt"), []byte(b.String()), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// renderField renders a single field as a human/LLM-friendly card: signature,
// arguments (with types, defaults and docs), deprecation, and an SDL snippet.
func (g *Generator) renderField(parent *ast.Definition, f *ast.FieldDefinition) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Field:  %s.%s\n", parent.Name, f.Name)
	fmt.Fprintf(&b, "Type:   %s\n", f.Type.String())
	if bt := baseType(f.Type); g.namedTypeExists(bt) {
		if td := g.Schema.Types[bt]; td != nil {
			fmt.Fprintf(&b, "Kind:   returns %s (see ../../%s/  or  references/%s)\n", strings.ToLower(string(td.Kind)), bt, f.Name)
		}
	}
	if f.Description != "" {
		fmt.Fprintf(&b, "\nDescription:\n%s\n", indent(f.Description, "  "))
	}
	if len(f.Arguments) > 0 {
		b.WriteString("\nArguments:\n")
		for _, a := range f.Arguments {
			def := ""
			if a.DefaultValue != nil {
				def = " = " + a.DefaultValue.String()
			}
			fmt.Fprintf(&b, "  %s: %s%s\n", a.Name, a.Type.String(), def)
			if a.Description != "" {
				fmt.Fprintf(&b, "%s\n", indent(oneLine(a.Description), "      "))
			}
		}
	}
	if dep := f.Directives.ForName("deprecated"); dep != nil {
		fmt.Fprintf(&b, "\nDeprecated: %s\n", directiveReason(dep))
	}
	fmt.Fprintf(&b, "\nSDL:\n  %s\n", fieldSDL(f))
	return b.String()
}

func (g *Generator) renderMeta(def *ast.Definition) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Name: %s\n", def.Name)
	fmt.Fprintf(&b, "Kind: %s\n", strings.ToLower(string(def.Kind)))
	switch def.Kind {
	case ast.Object, ast.Interface:
		fmt.Fprintf(&b, "Fields: %d\n", countPublic(def.Fields))
		if len(def.Interfaces) > 0 {
			fmt.Fprintf(&b, "Implements: %s\n", strings.Join(def.Interfaces, ", "))
		}
	case ast.InputObject:
		fmt.Fprintf(&b, "Input fields: %d\n", countPublic(def.Fields))
	case ast.Enum:
		fmt.Fprintf(&b, "Values: %d\n", len(def.EnumValues))
	case ast.Union:
		fmt.Fprintf(&b, "Possible types: %s\n", strings.Join(def.Types, ", "))
	}
	if def.Description != "" {
		fmt.Fprintf(&b, "\n%s\n", def.Description)
	}
	return b.String()
}

func (g *Generator) writeIndex(counts map[ast.DefinitionKind]int, names []string) error {
	sort.Strings(names)
	var b strings.Builder
	b.WriteString("GraphQL schema as a file tree\n")
	b.WriteString("=============================\n\n")
	b.WriteString("Type counts:\n")
	for _, k := range []ast.DefinitionKind{ast.Object, ast.Interface, ast.Union, ast.Enum, ast.InputObject, ast.Scalar} {
		fmt.Fprintf(&b, "  %-12s %d\n", strings.ToLower(string(k))+"s", counts[k])
	}
	writeRootList := func(title string, def *ast.Definition) {
		if def == nil {
			return
		}
		fmt.Fprintf(&b, "\n%s entry points (see %s/):\n", title, strings.ToLower(title))
		for _, f := range def.Fields {
			if isInternal(f.Name) {
				continue
			}
			fmt.Fprintf(&b, "  %s: %s\n", f.Name, f.Type.String())
		}
	}
	writeRootList("Query", g.Schema.Query)
	writeRootList("Mutation", g.Schema.Mutation)
	writeRootList("Subscription", g.Schema.Subscription)

	b.WriteString("\nAll types:\n")
	for _, n := range names {
		fmt.Fprintf(&b, "  %s\n", n)
	}
	return os.WriteFile(filepath.Join(g.Root, "index.txt"), []byte(b.String()), 0o644)
}

func (g *Generator) writeReadme() error {
	readme := `This directory is a GraphQL schema projected onto a file tree.

Goal: explore the schema with ordinary shell tools instead of reading the whole
SDL. Everything here is generated from schema.graphql.

Layout
  schema.graphql            the complete SDL (cat it if you want everything)
  index.txt                 type counts + every Query/Mutation/Subscription field
  query/    <field>.graphql  one card per root query field   (start here)
  mutation/ <field>.graphql  one card per root mutation field
  subscription/             one card per root subscription field
  directives/               declared directives
  types/<TypeName>/
    type.graphql            the type's own SDL block
    meta.txt                kind, field count, description
    fields/<field>.graphql  (objects/interfaces) signature, args, docs
    input_fields/<f>.graphql (input objects) signature, default, docs
    values/<value>.txt      (enums)
    references/<field>      SYMLINK to the field's return type directory
    implements/<iface>     SYMLINK (objects -> interfaces)
    implemented_by/<obj>   SYMLINK (interfaces -> objects)
    possible_types/<obj>   SYMLINK (unions -> members)

How to navigate (the references/ symlinks ARE the graph edges)
  cat index.txt                                  # overview + entry points
  cat query/items.graphql                        # an entry point's args + return
  ls  types/Item/fields                          # what fields an Item has
  cat types/Item/fields/column_values.graphql    # one field's details
  ls -l types/Item/references                     # follow a field to its type
  cat types/Item/references/column_values/type.graphql
  grep -ril "column" types/*/fields              # search fields by keyword

Build a query by starting at an entry point in query/ or mutation/, reading its
arguments, then walking references/ into the return type to pick sub-fields.
`
	return os.WriteFile(filepath.Join(g.Root, "README.txt"), []byte(readme), 0o644)
}

// --- helpers ---

func formatDefinition(def *ast.Definition) string {
	doc := &ast.SchemaDocument{Definitions: ast.DefinitionList{def}}
	var sb strings.Builder
	formatter.NewFormatter(&sb).FormatSchemaDocument(doc)
	return sb.String()
}

// fieldSDL renders a one-line SDL signature for a field, e.g.
// items(ids: [ID!], limit: Int = 25): [Item!].
func fieldSDL(f *ast.FieldDefinition) string {
	var b strings.Builder
	b.WriteString(f.Name)
	if len(f.Arguments) > 0 {
		args := make([]string, len(f.Arguments))
		for i, a := range f.Arguments {
			s := a.Name + ": " + a.Type.String()
			if a.DefaultValue != nil {
				s += " = " + a.DefaultValue.String()
			}
			args[i] = s
		}
		b.WriteString("(" + strings.Join(args, ", ") + ")")
	}
	b.WriteString(": " + f.Type.String())
	return b.String()
}

func baseType(t *ast.Type) string {
	for t.Elem != nil {
		t = t.Elem
	}
	return t.NamedType
}

func (g *Generator) namedTypeExists(name string) bool {
	if name == "" || isInternal(name) {
		return false
	}
	_, ok := g.Schema.Types[name]
	return ok
}

func directiveReason(d *ast.Directive) string {
	if a := d.Arguments.ForName("reason"); a != nil && a.Value != nil {
		return a.Value.Raw
	}
	return "(no reason given)"
}

func countPublic(fields ast.FieldList) int {
	n := 0
	for _, f := range fields {
		if !isInternal(f.Name) {
			n++
		}
	}
	return n
}

func isInternal(name string) bool { return strings.HasPrefix(name, "__") }

// safeName keeps file names filesystem-safe (GraphQL names are already
// [_A-Za-z][_0-9A-Za-z]*, so this is just defensive).
func safeName(name string) string {
	return strings.NewReplacer("/", "_", "\\", "_", "..", "_").Replace(name)
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func indent(s, pad string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i, l := range lines {
		lines[i] = pad + l
	}
	return strings.Join(lines, "\n")
}
