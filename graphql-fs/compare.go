package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/parser"
	"github.com/vektah/gqlparser/v2/validator"
)

// CompareReport is the objective, schema-aware comparison of two operations.
type CompareReport struct {
	ExpectedValid    bool     `json:"expected_valid"`
	ExpectedErrors   []string `json:"expected_errors,omitempty"`
	GeneratedValid   bool     `json:"generated_valid"`
	GeneratedErrors  []string `json:"generated_errors,omitempty"`
	OperationMatch   bool     `json:"operation_type_match"` // both query / both mutation

	// Selection structure (field paths, ignoring arguments).
	StructurePrecision float64  `json:"structure_precision"` // of generated, how much is correct
	StructureRecall    float64  `json:"structure_recall"`    // of expected, how much was produced
	StructureF1        float64  `json:"structure_f1"`
	MissingPaths       []string `json:"missing_paths,omitempty"` // in expected, not generated
	ExtraPaths         []string `json:"extra_paths,omitempty"`   // in generated, not expected

	// Full match (field path + canonical arguments) — the strict score.
	ArgsF1          float64  `json:"args_f1"`
	ArgMismatches   []string `json:"arg_mismatches,omitempty"`

	ExpectedNormalized  string `json:"-"`
	GeneratedNormalized string `json:"-"`
}

func runCompare(args []string) {
	fs := newFlagSet("compare")
	sdlSrc := fs.String("sdl", "", "path or http(s) URL to the GraphQL SDL (the schema to validate against)")
	expectedPath := fs.String("expected", "", "path to the ground-truth query")
	generatedPath := fs.String("generated", "", "path to the query to grade")
	asJSON := fs.Bool("json", false, "emit the report as JSON")
	_ = fs.Parse(args)

	if *sdlSrc == "" || *expectedPath == "" || *generatedPath == "" {
		fmt.Fprintln(os.Stderr, "usage: graphql-fs compare -sdl <file|url> -expected <file> -generated <file> [-json]")
		os.Exit(2)
	}

	sdl, err := loadSDL(*sdlSrc)
	if err != nil {
		fatal(err)
	}
	schema, err := loadSchema(sdl)
	if err != nil {
		fatal(fmt.Errorf("parse schema: %w", err))
	}

	expectedSrc := mustRead(*expectedPath)
	generatedSrc := mustRead(*generatedPath)

	report := compare(schema, expectedSrc, generatedSrc)

	if *asJSON {
		b, _ := json.MarshalIndent(report, "", "  ")
		fmt.Println(string(b))
		return
	}
	report.print()
}

func compare(schema *ast.Schema, expectedSrc, generatedSrc string) *CompareReport {
	r := &CompareReport{}

	expDoc, expErrs := parseAndValidate(schema, "expected.graphql", expectedSrc)
	genDoc, genErrs := parseAndValidate(schema, "generated.graphql", generatedSrc)

	r.ExpectedValid = len(expErrs) == 0
	r.ExpectedErrors = expErrs
	r.GeneratedValid = len(genErrs) == 0
	r.GeneratedErrors = genErrs

	expPaths := collectFieldPaths(expDoc)
	genPaths := collectFieldPaths(genDoc)

	r.OperationMatch = operationType(expDoc) == operationType(genDoc)

	// Structure: bare field paths.
	expStruct := keySet(expPaths)
	genStruct := keySet(genPaths)
	common := intersect(expStruct, genStruct)
	r.StructurePrecision = ratio(len(common), len(genStruct))
	r.StructureRecall = ratio(len(common), len(expStruct))
	r.StructureF1 = f1(r.StructurePrecision, r.StructureRecall)
	r.MissingPaths = sortedDiff(expStruct, genStruct)
	r.ExtraPaths = sortedDiff(genStruct, expStruct)

	// Strict: field path + canonical arguments.
	expFull := fullSet(expPaths)
	genFull := fullSet(genPaths)
	fullCommon := intersect(expFull, genFull)
	r.ArgsF1 = f1(ratio(len(fullCommon), len(genFull)), ratio(len(fullCommon), len(expFull)))

	// Argument-level mismatches: a path present in both whose args differ.
	for path, eArgs := range expPaths {
		if gArgs, ok := genPaths[path]; ok && eArgs != gArgs {
			r.ArgMismatches = append(r.ArgMismatches, fmt.Sprintf("%s\n    expected args:  %s\n    generated args: %s", path, emptyDash(eArgs), emptyDash(gArgs)))
		}
	}
	sort.Strings(r.ArgMismatches)

	r.ExpectedNormalized = normalizedLines(expPaths)
	r.GeneratedNormalized = normalizedLines(genPaths)
	return r
}

func parseAndValidate(schema *ast.Schema, name, src string) (*ast.QueryDocument, []string) {
	doc, err := parser.ParseQuery(&ast.Source{Name: name, Input: src})
	if err != nil {
		return nil, []string{err.Error()}
	}
	var errs []string
	for _, e := range validator.Validate(schema, doc) {
		errs = append(errs, e.Error())
	}
	return doc, errs
}

func operationType(doc *ast.QueryDocument) string {
	if doc == nil || len(doc.Operations) == 0 {
		return ""
	}
	return string(doc.Operations[0].Operation)
}

// collectFieldPaths walks every operation and returns a map of
// dotted-field-path -> canonical-arguments-at-that-path.
func collectFieldPaths(doc *ast.QueryDocument) map[string]string {
	out := map[string]string{}
	if doc == nil {
		return out
	}
	for _, op := range doc.Operations {
		walkSelectionSet(string(op.Operation), op.SelectionSet, doc, out)
	}
	return out
}

func walkSelectionSet(prefix string, set ast.SelectionSet, doc *ast.QueryDocument, out map[string]string) {
	for _, sel := range set {
		switch s := sel.(type) {
		case *ast.Field:
			path := prefix + "." + s.Name
			out[path] = argsCanon(s.Arguments)
			walkSelectionSet(path, s.SelectionSet, doc, out)
		case *ast.InlineFragment:
			walkSelectionSet(prefix, s.SelectionSet, doc, out)
		case *ast.FragmentSpread:
			if s.Definition != nil {
				walkSelectionSet(prefix, s.Definition.SelectionSet, doc, out)
			} else if doc != nil {
				for _, fd := range doc.Fragments {
					if fd.Name == s.Name {
						walkSelectionSet(prefix, fd.SelectionSet, doc, out)
					}
				}
			}
		}
	}
}

func argsCanon(args ast.ArgumentList) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for _, a := range args {
		parts = append(parts, a.Name+": "+valueCanon(a.Value))
	}
	sort.Strings(parts)
	return "(" + strings.Join(parts, ", ") + ")"
}

// valueCanon renders a value canonically: object fields are sorted by name so
// argument order never affects the comparison.
func valueCanon(v *ast.Value) string {
	if v == nil {
		return "null"
	}
	switch v.Kind {
	case ast.ObjectValue:
		parts := make([]string, 0, len(v.Children))
		for _, c := range v.Children {
			parts = append(parts, c.Name+": "+valueCanon(c.Value))
		}
		sort.Strings(parts)
		return "{" + strings.Join(parts, ", ") + "}"
	case ast.ListValue:
		parts := make([]string, 0, len(v.Children))
		for _, c := range v.Children {
			parts = append(parts, valueCanon(c.Value))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case ast.Variable:
		return "$" + v.Raw
	case ast.StringValue, ast.BlockValue:
		return strconv.Quote(v.Raw)
	default:
		return v.Raw
	}
}

// --- set helpers ---

func keySet(m map[string]string) map[string]bool {
	s := make(map[string]bool, len(m))
	for k := range m {
		s[k] = true
	}
	return s
}

func fullSet(m map[string]string) map[string]bool {
	s := make(map[string]bool, len(m))
	for k, v := range m {
		s[k+v] = true
	}
	return s
}

func intersect(a, b map[string]bool) []string {
	var out []string
	for k := range a {
		if b[k] {
			out = append(out, k)
		}
	}
	return out
}

func sortedDiff(a, b map[string]bool) []string {
	var out []string
	for k := range a {
		if !b[k] {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func ratio(num, den int) float64 {
	if den == 0 {
		return 0
	}
	return float64(num) / float64(den)
}

func f1(p, r float64) float64 {
	if p+r == 0 {
		return 0
	}
	return 2 * p * r / (p + r)
}

func normalizedLines(m map[string]string) string {
	lines := make([]string, 0, len(m))
	for k, v := range m {
		lines = append(lines, k+v)
	}
	sort.Strings(lines)
	return strings.Join(lines, "\n")
}

func emptyDash(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}

func mustRead(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		fatal(err)
	}
	return string(b)
}

func (r *CompareReport) print() {
	fmt.Printf("expected valid:    %v\n", checkmark(r.ExpectedValid))
	for _, e := range r.ExpectedErrors {
		fmt.Printf("    ! %s\n", e)
	}
	fmt.Printf("generated valid:   %v\n", checkmark(r.GeneratedValid))
	for _, e := range r.GeneratedErrors {
		fmt.Printf("    ! %s\n", e)
	}
	fmt.Printf("operation match:   %v\n", checkmark(r.OperationMatch))
	fmt.Printf("\nselection structure (field paths):\n")
	fmt.Printf("    precision %.2f  recall %.2f  f1 %.2f\n", r.StructurePrecision, r.StructureRecall, r.StructureF1)
	fmt.Printf("strict (paths + arguments):\n")
	fmt.Printf("    f1 %.2f\n", r.ArgsF1)
	if len(r.MissingPaths) > 0 {
		fmt.Printf("\nmissing (in expected, not generated):\n")
		for _, p := range r.MissingPaths {
			fmt.Printf("    - %s\n", p)
		}
	}
	if len(r.ExtraPaths) > 0 {
		fmt.Printf("\nextra (in generated, not expected):\n")
		for _, p := range r.ExtraPaths {
			fmt.Printf("    + %s\n", p)
		}
	}
	if len(r.ArgMismatches) > 0 {
		fmt.Printf("\nargument mismatches:\n")
		for _, m := range r.ArgMismatches {
			fmt.Printf("    ~ %s\n", m)
		}
	}
}

func checkmark(b bool) string {
	if b {
		return "yes"
	}
	return "NO"
}
