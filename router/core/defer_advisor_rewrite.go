package core

import (
	"fmt"
	"slices"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
)

// deferGroup describes one set of sibling fields that should be moved into a
// single inline fragment annotated with @defer(label: Label).
type deferGroup struct {
	// ParentPath is the response-name path from the operation root to the
	// selection set that contains the fields, without array ("@") segments.
	ParentPath []string
	// Fields are the response names of the fields to move into the deferred fragment.
	Fields []string
	Label  string
}

// rewriteOperationWithDefer parses the operation, and for every group moves the
// listed fields at the given path into `... @defer(label: "...") { <fields> }`.
// The rewritten operation is returned as a pretty-printed string.
func rewriteOperationWithDefer(operation string, operationName string, groups []deferGroup) (string, error) {
	doc, report := astparser.ParseGraphqlDocumentString(operation)
	if report.HasErrors() {
		return "", fmt.Errorf("failed to parse operation: %s", report.Error())
	}

	opRef, err := selectOperationDefinition(&doc, operationName)
	if err != nil {
		return "", err
	}
	if !doc.OperationDefinitions[opRef].HasSelections {
		return "", fmt.Errorf("operation %q has no selections", operationName)
	}
	if len(groups) == 0 {
		return operation, nil
	}
	if err := validateDeferGroups(groups); err != nil {
		return "", err
	}
	fragmentUsage, err := analyzeFragmentUsage(&doc)
	if err != nil {
		return "", err
	}

	plans := make([]deferGroupPlan, 0, len(groups))
	generatedLabels := make(map[string]struct{})
	for _, group := range groups {
		setRef, err := findSelectionSetByPath(&doc, doc.OperationDefinitions[opRef].SelectionSet, group.ParentPath)
		if err != nil {
			return "", err
		}
		plan, err := planDeferGroup(&doc, setRef, group, fragmentUsage)
		if err != nil {
			return "", err
		}
		for _, label := range plan.labels {
			if _, exists := generatedLabels[label]; exists {
				return "", fmt.Errorf("defer label %q is generated more than once", label)
			}
			generatedLabels[label] = struct{}{}
		}
		plans = append(plans, plan)
	}

	for _, plan := range plans {
		for i, setRef := range plan.setRefs {
			wrapFieldsInSet(&doc, setRef, plan.fieldsBySet[setRef], plan.labels[i])
		}
	}

	return astprinter.PrintStringIndent(&doc, "  ")
}

type fragmentUsageAnalysis struct {
	usesByFragment        map[int]int
	fragmentOwnerBySetRef map[int]int
}

func analyzeFragmentUsage(doc *ast.Document) (*fragmentUsageAnalysis, error) {
	analysis := &fragmentUsageAnalysis{
		usesByFragment:        make(map[int]int),
		fragmentOwnerBySetRef: make(map[int]int),
	}

	var markFragmentSelectionSets func(setRef int, fragmentRef int)
	markFragmentSelectionSets = func(setRef int, fragmentRef int) {
		if _, exists := analysis.fragmentOwnerBySetRef[setRef]; exists {
			return
		}
		analysis.fragmentOwnerBySetRef[setRef] = fragmentRef
		for _, selectionRef := range doc.SelectionSets[setRef].SelectionRefs {
			selection := doc.Selections[selectionRef]
			switch selection.Kind {
			case ast.SelectionKindField:
				if doc.Fields[selection.Ref].HasSelections {
					markFragmentSelectionSets(doc.Fields[selection.Ref].SelectionSet, fragmentRef)
				}
			case ast.SelectionKindInlineFragment:
				if doc.InlineFragments[selection.Ref].HasSelections {
					markFragmentSelectionSets(doc.InlineFragments[selection.Ref].SelectionSet, fragmentRef)
				}
			}
		}
	}
	for _, rootNode := range doc.RootNodes {
		if rootNode.Kind == ast.NodeKindFragmentDefinition && doc.FragmentDefinitions[rootNode.Ref].HasSelections {
			markFragmentSelectionSets(doc.FragmentDefinitions[rootNode.Ref].SelectionSet, rootNode.Ref)
		}
	}

	expansionsByFragment := make(map[int]int)
	var walkSelectionSet func(setRef int, fragmentStack []int) error
	walkSelectionSet = func(setRef int, fragmentStack []int) error {
		for _, selectionRef := range doc.SelectionSets[setRef].SelectionRefs {
			selection := doc.Selections[selectionRef]
			switch selection.Kind {
			case ast.SelectionKindField:
				if doc.Fields[selection.Ref].HasSelections {
					if err := walkSelectionSet(doc.Fields[selection.Ref].SelectionSet, fragmentStack); err != nil {
						return err
					}
				}
			case ast.SelectionKindInlineFragment:
				if doc.InlineFragments[selection.Ref].HasSelections {
					if err := walkSelectionSet(doc.InlineFragments[selection.Ref].SelectionSet, fragmentStack); err != nil {
						return err
					}
				}
			case ast.SelectionKindFragmentSpread:
				fragmentName := doc.FragmentSpreadNameString(selection.Ref)
				fragmentRef, exists := doc.FragmentDefinitionRef(doc.FragmentSpreadNameBytes(selection.Ref))
				if !exists {
					return fmt.Errorf("fragment %q is not defined", fragmentName)
				}
				if cycleStart := slices.Index(fragmentStack, fragmentRef); cycleStart != -1 {
					cycle := make([]string, 0, len(fragmentStack)-cycleStart+1)
					for _, ref := range fragmentStack[cycleStart:] {
						cycle = append(cycle, doc.FragmentDefinitionNameString(ref))
					}
					cycle = append(cycle, fragmentName)
					return fmt.Errorf("fragment cycle detected: %s", strings.Join(cycle, " -> "))
				}
				if analysis.usesByFragment[fragmentRef] < 2 {
					analysis.usesByFragment[fragmentRef]++
				}
				// Two expansions are enough to establish that this fragment and
				// every transitively referenced fragment are shared.
				if expansionsByFragment[fragmentRef] >= 2 || !doc.FragmentDefinitions[fragmentRef].HasSelections {
					continue
				}
				expansionsByFragment[fragmentRef]++
				if err := walkSelectionSet(doc.FragmentDefinitions[fragmentRef].SelectionSet, append(fragmentStack, fragmentRef)); err != nil {
					return err
				}
			}
		}
		return nil
	}

	for _, rootNode := range doc.RootNodes {
		if rootNode.Kind != ast.NodeKindOperationDefinition || !doc.OperationDefinitions[rootNode.Ref].HasSelections {
			continue
		}
		if err := walkSelectionSet(doc.OperationDefinitions[rootNode.Ref].SelectionSet, nil); err != nil {
			return nil, err
		}
	}
	return analysis, nil
}

func validateDeferGroups(groups []deferGroup) error {
	fieldsByPath := make(map[string]map[string]struct{})
	for i, group := range groups {
		if len(group.Fields) == 0 {
			return fmt.Errorf("defer group %d has no fields", i+1)
		}

		counts := make(map[string]int, len(group.Fields))
		for _, field := range group.Fields {
			if field == "" {
				return fmt.Errorf("defer group %d has an empty field response name", i+1)
			}
			counts[field]++
		}

		duplicates := make([]string, 0)
		for field, count := range counts {
			if count > 1 {
				duplicates = append(duplicates, field)
			}
		}
		if len(duplicates) != 0 {
			slices.Sort(duplicates)
			return fmt.Errorf("defer group %d has duplicate fields %v", i+1, duplicates)
		}

		pathKey := strings.Join(group.ParentPath, "\x00")
		seen := fieldsByPath[pathKey]
		if seen == nil {
			seen = make(map[string]struct{}, len(group.Fields))
			fieldsByPath[pathKey] = seen
		}
		overlaps := make([]string, 0)
		for _, field := range group.Fields {
			if _, exists := seen[field]; exists {
				overlaps = append(overlaps, field)
			}
		}
		if len(overlaps) != 0 {
			slices.Sort(overlaps)
			return fmt.Errorf("defer group %d overlaps an earlier group at path %q: fields %v", i+1, formatRewritePath(group.ParentPath), overlaps)
		}
		for _, field := range group.Fields {
			seen[field] = struct{}{}
		}
	}
	return nil
}

func formatRewritePath(path []string) string {
	if len(path) == 0 {
		return "<root>"
	}
	return strings.Join(path, ".")
}

func selectOperationDefinition(doc *ast.Document, operationName string) (int, error) {
	operationRefs := make([]int, 0, len(doc.OperationDefinitions))
	for _, rootNode := range doc.RootNodes {
		if rootNode.Kind == ast.NodeKindOperationDefinition {
			operationRefs = append(operationRefs, rootNode.Ref)
		}
	}

	if operationName == "" {
		if len(operationRefs) > 1 {
			return -1, fmt.Errorf("operation name is required when multiple operations are defined")
		}
		if len(operationRefs) == 1 {
			return operationRefs[0], nil
		}
		return -1, fmt.Errorf("operation %q not found", operationName)
	}

	for _, ref := range operationRefs {
		if doc.OperationDefinitionNameString(ref) == operationName {
			return ref, nil
		}
	}
	return -1, fmt.Errorf("operation %q not found", operationName)
}

// stripDeferDirectives removes every @defer from the document: bare deferred
// inline fragments are unwrapped into their parent selection set, fragments
// with a type condition (and fragment spreads) just lose the directive. The
// advisor profiles the un-deferred operation, so pre-deferred operations are
// normalized with this before analysis. Returns the original text unchanged
// when no @defer is present.
func stripDeferDirectives(operation string) (string, error) {
	doc, report := astparser.ParseGraphqlDocumentString(operation)
	if report.HasErrors() {
		return "", fmt.Errorf("failed to parse operation: %s", report.Error())
	}

	stripped := false
	removeDefer := func(list *ast.DirectiveList) bool {
		removed := false
		refs := list.Refs[:0]
		for _, directiveRef := range list.Refs {
			if doc.DirectiveNameString(directiveRef) == "defer" {
				stripped = true
				removed = true
				continue
			}
			refs = append(refs, directiveRef)
		}
		list.Refs = refs
		return removed
	}

	var walkSelectionSet func(setRef int)
	walkSelectionSet = func(setRef int) {
		selectionRefs := make([]int, 0, len(doc.SelectionSets[setRef].SelectionRefs))
		for _, selRef := range doc.SelectionSets[setRef].SelectionRefs {
			sel := doc.Selections[selRef]
			switch sel.Kind {
			case ast.SelectionKindField:
				if doc.Fields[sel.Ref].HasSelections {
					walkSelectionSet(doc.Fields[sel.Ref].SelectionSet)
				}
				selectionRefs = append(selectionRefs, selRef)
			case ast.SelectionKindFragmentSpread:
				removeDefer(&doc.FragmentSpreads[sel.Ref].Directives)
				doc.FragmentSpreads[sel.Ref].HasDirectives = len(doc.FragmentSpreads[sel.Ref].Directives.Refs) > 0
				selectionRefs = append(selectionRefs, selRef)
			case ast.SelectionKindInlineFragment:
				fragment := &doc.InlineFragments[sel.Ref]
				if fragment.HasSelections {
					walkSelectionSet(fragment.SelectionSet)
				}
				removedDefer := removeDefer(&fragment.Directives)
				fragment.HasDirectives = len(fragment.Directives.Refs) > 0
				// A fragment that only existed to carry @defer is unwrapped.
				if removedDefer && !fragment.HasDirectives && fragment.TypeCondition.Type == -1 && fragment.HasSelections {
					selectionRefs = append(selectionRefs, doc.SelectionSets[fragment.SelectionSet].SelectionRefs...)
					continue
				}
				selectionRefs = append(selectionRefs, selRef)
			}
		}
		doc.SelectionSets[setRef].SelectionRefs = selectionRefs
	}

	for _, rootNode := range doc.RootNodes {
		switch rootNode.Kind {
		case ast.NodeKindOperationDefinition:
			if doc.OperationDefinitions[rootNode.Ref].HasSelections {
				walkSelectionSet(doc.OperationDefinitions[rootNode.Ref].SelectionSet)
			}
		case ast.NodeKindFragmentDefinition:
			if doc.FragmentDefinitions[rootNode.Ref].HasSelections {
				walkSelectionSet(doc.FragmentDefinitions[rootNode.Ref].SelectionSet)
			}
		}
	}

	if !stripped {
		return operation, nil
	}
	return astprinter.PrintStringIndent(&doc, "  ")
}

// findSelectionSetByPath walks response-name path segments from the given
// selection set, descending through fields and transparently through inline
// fragments and fragment spreads, and returns the selection set ref at the end
// of the path.
func findSelectionSetByPath(doc *ast.Document, setRef int, path []string) (int, error) {
	currentSetRef := setRef
	for i, segment := range path {
		locations := collectFieldSelectionLocations(doc, currentSetRef, segment, make(map[int]bool), nil)
		if len(locations) == 0 {
			return -1, fmt.Errorf(
				"field %q not found at path %q while resolving rewrite path %q",
				segment,
				formatRewritePath(path[:i]),
				formatRewritePath(path),
			)
		}
		if len(locations) > 1 {
			return -1, fmt.Errorf("field %q at rewrite path %q is selected in multiple branches", segment, formatRewritePath(path[:i+1]))
		}
		fieldRef := locations[0].fieldRef
		if !doc.Fields[fieldRef].HasSelections {
			return -1, fmt.Errorf("field %q at rewrite path %q has no selection set", segment, formatRewritePath(path[:i+1]))
		}
		currentSetRef = doc.Fields[fieldRef].SelectionSet
	}
	return currentSetRef, nil
}

// findFieldInSelectionSet finds a field by response name in a selection set,
// searching nested inline fragments and fragment spreads transparently.
func findFieldInSelectionSet(doc *ast.Document, setRef int, responseName string) (int, bool) {
	locations := collectFieldSelectionLocations(doc, setRef, responseName, make(map[int]bool), nil)
	if len(locations) == 0 {
		return -1, false
	}
	return locations[0].fieldRef, true
}

type fieldSelectionLocation struct {
	fieldRef int
	setRef   int
}

// collectFieldSelectionLocations records every matching direct field. The
// operation AST alone cannot prove that distinct type conditions are disjoint
// (interfaces and unions may overlap), so callers fail closed on more than one
// location for the same response name.
func collectFieldSelectionLocations(doc *ast.Document, setRef int, responseName string, visitedFragments map[int]bool, out []fieldSelectionLocation) []fieldSelectionLocation {
	for _, selRef := range doc.SelectionSets[setRef].SelectionRefs {
		sel := doc.Selections[selRef]
		switch sel.Kind {
		case ast.SelectionKindField:
			if doc.FieldAliasOrNameString(sel.Ref) == responseName {
				out = append(out, fieldSelectionLocation{
					fieldRef: sel.Ref,
					setRef:   setRef,
				})
			}
		case ast.SelectionKindInlineFragment:
			if doc.InlineFragments[sel.Ref].HasSelections {
				out = collectFieldSelectionLocations(doc, doc.InlineFragments[sel.Ref].SelectionSet, responseName, visitedFragments, out)
			}
		case ast.SelectionKindFragmentSpread:
			fragmentRef, exists := doc.FragmentDefinitionRef(doc.FragmentSpreadNameBytes(sel.Ref))
			if !exists || visitedFragments[fragmentRef] || !doc.FragmentDefinitions[fragmentRef].HasSelections {
				continue
			}
			visitedFragments[fragmentRef] = true
			out = collectFieldSelectionLocations(doc, doc.FragmentDefinitions[fragmentRef].SelectionSet, responseName, visitedFragments, out)
		}
	}
	return out
}

type deferGroupPlan struct {
	fieldsBySet map[int][]string
	setRefs     []int
	labels      []string
}

// planDeferGroup resolves and validates all target locations without mutating
// the AST. The caller reserves every generated label for every plan before any
// wrapping begins.
func planDeferGroup(doc *ast.Document, setRef int, group deferGroup, fragmentUsage *fragmentUsageAnalysis) (deferGroupPlan, error) {
	rewritePath := formatRewritePath(group.ParentPath)
	fieldsBySet := make(map[int][]string)
	missing := make([]string, 0)
	for _, name := range group.Fields {
		locations := collectFieldSelectionLocations(doc, setRef, name, make(map[int]bool), nil)
		if len(locations) == 0 {
			missing = append(missing, name)
			continue
		}
		if len(locations) > 1 {
			return deferGroupPlan{}, fmt.Errorf("field %q is selected in multiple branches at rewrite path %q", name, rewritePath)
		}

		fieldsBySet[locations[0].setRef] = append(fieldsBySet[locations[0].setRef], name)
	}
	if len(missing) != 0 {
		slices.Sort(missing)
		if len(missing) == 1 {
			return deferGroupPlan{}, fmt.Errorf("field %q not found at rewrite path %q", missing[0], rewritePath)
		}
		return deferGroupPlan{}, fmt.Errorf("fields %v not found at rewrite path %q", missing, rewritePath)
	}

	sharedFragments := make(map[string]struct{})
	for containingSet := range fieldsBySet {
		fragmentRef, belongsToFragment := fragmentUsage.fragmentOwnerBySetRef[containingSet]
		if belongsToFragment && fragmentUsage.usesByFragment[fragmentRef] > 1 {
			sharedFragments[doc.FragmentDefinitionNameString(fragmentRef)] = struct{}{}
		}
	}
	if len(sharedFragments) != 0 {
		names := make([]string, 0, len(sharedFragments))
		for name := range sharedFragments {
			names = append(names, name)
		}
		slices.Sort(names)
		if len(names) == 1 {
			return deferGroupPlan{}, fmt.Errorf("fragment %q is used by multiple operation paths; rewriting it would affect unrelated selections", names[0])
		}
		return deferGroupPlan{}, fmt.Errorf("fragments %v are used by multiple operation paths; rewriting them would affect unrelated selections", names)
	}

	setRefs := make([]int, 0, len(fieldsBySet))
	for ref := range fieldsBySet {
		setRefs = append(setRefs, ref)
	}
	slices.Sort(setRefs)

	labels := make([]string, len(setRefs))
	for i := range setRefs {
		labels[i] = group.Label
		if i > 0 {
			labels[i] = fmt.Sprintf("%s_%d", group.Label, i+1)
		}
	}
	return deferGroupPlan{
		fieldsBySet: fieldsBySet,
		setRefs:     setRefs,
		labels:      labels,
	}, nil
}

// wrapFieldsInSet removes the planned direct selections from a selection set
// and re-adds them inside an inline fragment carrying @defer(label: label).
// Planning has already established exactly one location per response name.
func wrapFieldsInSet(doc *ast.Document, setRef int, responseNames []string, label string) {
	wanted := make(map[string]bool, len(responseNames))
	for _, name := range responseNames {
		wanted[name] = true
	}

	var moved, remaining []int
	// The fragment replaces the first moved field, so deferring keeps the
	// field's position in the operation instead of pushing it to the end.
	insertAt := -1
	for _, selRef := range doc.SelectionSets[setRef].SelectionRefs {
		sel := doc.Selections[selRef]
		if sel.Kind == ast.SelectionKindField && wanted[doc.FieldAliasOrNameString(sel.Ref)] {
			if insertAt == -1 {
				insertAt = len(remaining)
			}
			moved = append(moved, selRef)
			continue
		}
		remaining = append(remaining, selRef)
	}
	labelValueRef := doc.ImportStringValue([]byte(label), false)
	argRef := doc.ImportArgument("label", ast.Value{Kind: ast.ValueKindString, Ref: labelValueRef})
	directiveRef := doc.ImportDirective("defer", []int{argRef})

	fragmentSetRef := doc.AddSelectionSetToDocument(ast.SelectionSet{SelectionRefs: moved})
	fragmentRef := doc.AddInlineFragment(ast.InlineFragment{
		TypeCondition: ast.TypeCondition{Type: -1},
		HasSelections: true,
		SelectionSet:  fragmentSetRef,
		HasDirectives: true,
		Directives:    ast.DirectiveList{Refs: []int{directiveRef}},
	})
	fragmentSelRef := doc.AddSelectionToDocument(ast.Selection{Kind: ast.SelectionKindInlineFragment, Ref: fragmentRef})

	if insertAt == -1 {
		insertAt = len(remaining)
	}
	selectionRefs := make([]int, 0, len(remaining)+1)
	selectionRefs = append(selectionRefs, remaining[:insertAt]...)
	selectionRefs = append(selectionRefs, fragmentSelRef)
	selectionRefs = append(selectionRefs, remaining[insertAt:]...)
	doc.SelectionSets[setRef].SelectionRefs = selectionRefs
}
