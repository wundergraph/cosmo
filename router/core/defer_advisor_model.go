package core

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// advisorFetch is the advisor's request-local view of one query-plan fetch.
type advisorFetch struct {
	fetchID   int
	kind      string
	subgraph  string
	path      string
	dependsOn []int
	// fields are the top-level response names this fetch provides at its path.
	fields []string
	// clientParentPath is the fetch path without "@" segments: the client-query
	// selection set the fields live in.
	clientParentPath []string
	durationsMs      []float64
	// fieldLatenciesMs is keyed by field response name, one value per split run.
	fieldLatenciesMs map[string][]float64
}

func (f *advisorFetch) clientFieldPath(field string) string {
	if len(f.clientParentPath) == 0 {
		return field
	}
	return strings.Join(f.clientParentPath, ".") + "." + field
}

type advisorTraceEnvelope struct {
	Fetches *advisorTraceNode `json:"fetches"`
}

type advisorTraceNode struct {
	Kind     string              `json:"kind"`
	Children []*advisorTraceNode `json:"children,omitempty"`
	Fetch    *advisorTraceFetch  `json:"fetch,omitempty"`
}

type advisorTraceFetch struct {
	Kind       string              `json:"kind"`
	Path       string              `json:"path"`
	SourceName string              `json:"source_name"`
	Trace      *advisorLoadTrace   `json:"trace,omitempty"`
	Traces     []*advisorLoadTrace `json:"traces,omitempty"`
}

type advisorLoadTrace struct {
	DurationLoadNano int64 `json:"duration_load_nanoseconds"`
}

type advisorQueryPlanNode struct {
	Kind     string                  `json:"kind"`
	Children []*advisorQueryPlanNode `json:"children,omitempty"`
	Fetch    *advisorQueryPlanFetch  `json:"fetch,omitempty"`
}

type advisorQueryPlanFetch struct {
	Kind              string `json:"kind"`
	Path              string `json:"path"`
	SubgraphName      string `json:"subgraphName"`
	FetchID           int    `json:"fetchId"`
	DependsOnFetchIDs []int  `json:"dependsOnFetchIds"`
	Query             string `json:"query"`
}

// buildFetchModel flattens the query plan in structural DFS order and validates
// the fetch dependency graph before any profiling samples are attached.
func buildFetchModel(root *advisorQueryPlanNode) ([]*advisorFetch, error) {
	var fetches []*advisorFetch
	byID := make(map[int]*advisorFetch)
	var walk func(node *advisorQueryPlanNode) error
	walk = func(node *advisorQueryPlanNode) error {
		if node == nil {
			return nil
		}
		if node.Fetch != nil {
			if _, exists := byID[node.Fetch.FetchID]; exists {
				return fmt.Errorf("query plan contains duplicate fetch id %d", node.Fetch.FetchID)
			}
			fields, err := topLevelFieldsOfFetchQuery(node.Fetch.Query)
			if err != nil {
				return fmt.Errorf("fetch %d (%s): %w", node.Fetch.FetchID, node.Fetch.SubgraphName, err)
			}
			var clientParentPath []string
			for segment := range strings.SplitSeq(node.Fetch.Path, ".") {
				if segment == "@" || segment == "" {
					continue
				}
				clientParentPath = append(clientParentPath, segment)
			}
			fetch := &advisorFetch{
				fetchID:          node.Fetch.FetchID,
				kind:             node.Fetch.Kind,
				subgraph:         node.Fetch.SubgraphName,
				path:             node.Fetch.Path,
				dependsOn:        slices.Clone(node.Fetch.DependsOnFetchIDs),
				fields:           fields,
				clientParentPath: clientParentPath,
			}
			byID[fetch.fetchID] = fetch
			fetches = append(fetches, fetch)
		}
		for _, child := range node.Children {
			if err := walk(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root); err != nil {
		return nil, err
	}
	if len(fetches) == 0 {
		return nil, fmt.Errorf("query plan contains no fetches")
	}
	for _, fetch := range fetches {
		for _, dependencyID := range fetch.dependsOn {
			if _, exists := byID[dependencyID]; !exists {
				return nil, fmt.Errorf("fetch %d (%s) depends on missing fetch %d", fetch.fetchID, fetch.subgraph, dependencyID)
			}
		}
	}
	if err := validateAdvisorFetchDAG(fetches, byID); err != nil {
		return nil, err
	}
	return fetches, nil
}

func validateAdvisorFetchDAG(fetches []*advisorFetch, byID map[int]*advisorFetch) error {
	const (
		unvisited uint8 = iota
		visiting
		visited
	)
	state := make(map[int]uint8, len(fetches))
	stack := make([]int, 0, len(fetches))
	var visit func(fetch *advisorFetch) error
	visit = func(fetch *advisorFetch) error {
		switch state[fetch.fetchID] {
		case visited:
			return nil
		case visiting:
			cycleStart := slices.Index(stack, fetch.fetchID)
			cycle := append(slices.Clone(stack[cycleStart:]), fetch.fetchID)
			parts := make([]string, len(cycle))
			for i, id := range cycle {
				parts[i] = fmt.Sprint(id)
			}
			return fmt.Errorf("query plan fetch dependency cycle: %s", strings.Join(parts, " -> "))
		}

		state[fetch.fetchID] = visiting
		stack = append(stack, fetch.fetchID)
		for _, dependencyID := range fetch.dependsOn {
			if err := visit(byID[dependencyID]); err != nil {
				return err
			}
		}
		stack = stack[:len(stack)-1]
		state[fetch.fetchID] = visited
		return nil
	}
	for _, fetch := range fetches {
		if state[fetch.fetchID] == unvisited {
			if err := visit(fetch); err != nil {
				return err
			}
		}
	}
	return nil
}

// topLevelFieldsOfFetchQuery parses a fetch's subgraph operation and returns
// the response names it provides: for entity fetches the top-level fields of
// the _entities inline fragments, otherwise the operation's root fields.
func topLevelFieldsOfFetchQuery(query string) ([]string, error) {
	doc, report := astparser.ParseGraphqlDocumentString(query)
	if report.HasErrors() {
		return nil, fmt.Errorf("failed to parse fetch query: %s", report.Error())
	}
	operationRefs := make([]int, 0, len(doc.OperationDefinitions))
	for _, rootNode := range doc.RootNodes {
		if rootNode.Kind == ast.NodeKindOperationDefinition {
			operationRefs = append(operationRefs, rootNode.Ref)
		}
	}
	if len(operationRefs) != 1 {
		return nil, fmt.Errorf("fetch query must contain exactly one operation, got %d", len(operationRefs))
	}
	opRef := operationRefs[0]
	if !doc.OperationDefinitions[opRef].HasSelections {
		return nil, fmt.Errorf("fetch query has no operation selections")
	}
	rootSetRef := doc.OperationDefinitions[opRef].SelectionSet

	if entitiesFieldRef, ok := findDirectFieldByName(&doc, rootSetRef, "_entities"); ok {
		if !doc.Fields[entitiesFieldRef].HasSelections {
			return nil, fmt.Errorf("_entities has no selections")
		}
		var fields []string
		collectTopLevelFields(&doc, doc.Fields[entitiesFieldRef].SelectionSet, &fields)
		return fields, nil
	}

	var fields []string
	collectTopLevelFields(&doc, rootSetRef, &fields)
	return fields, nil
}

func findDirectFieldByName(doc *ast.Document, setRef int, fieldName string) (int, bool) {
	for _, selectionRef := range doc.SelectionSets[setRef].SelectionRefs {
		selection := doc.Selections[selectionRef]
		if selection.Kind == ast.SelectionKindField && doc.FieldNameString(selection.Ref) == fieldName {
			return selection.Ref, true
		}
	}
	return -1, false
}

// collectTopLevelFields gathers field response names of a selection set,
// descending through inline fragments but not into field sub-selections.
func collectTopLevelFields(doc *ast.Document, setRef int, fields *[]string) {
	for _, selRef := range doc.SelectionSets[setRef].SelectionRefs {
		sel := doc.Selections[selRef]
		switch sel.Kind {
		case ast.SelectionKindField:
			name := doc.FieldAliasOrNameString(sel.Ref)
			if name == "__typename" || slices.Contains(*fields, name) {
				continue
			}
			*fields = append(*fields, name)
		case ast.SelectionKindInlineFragment:
			if doc.InlineFragments[sel.Ref].HasSelections {
				collectTopLevelFields(doc, doc.InlineFragments[sel.Ref].SelectionSet, fields)
			}
		}
	}
}

// mergeTraceDurations zips the trace and plan in their shared structural DFS
// order, verifies every observable fetch identity, and only then appends the
// run's load durations. The trace wire shape does not expose fetch IDs.
func mergeTraceDurations(fetches []*advisorFetch, root *advisorTraceNode) error {
	var traceFetches []*advisorTraceFetch
	var walk func(node *advisorTraceNode)
	walk = func(node *advisorTraceNode) {
		if node == nil {
			return
		}
		if node.Fetch != nil {
			traceFetches = append(traceFetches, node.Fetch)
		}
		for _, child := range node.Children {
			walk(child)
		}
	}
	walk(root)
	if len(traceFetches) != len(fetches) {
		return fmt.Errorf("trace has %d fetches, query plan has %d", len(traceFetches), len(fetches))
	}

	durations := make([]float64, len(fetches))
	for i, traceFetch := range traceFetches {
		planFetch := fetches[i]
		if traceFetch.Kind != planFetch.kind || traceFetch.Path != planFetch.path || traceFetch.SourceName != planFetch.subgraph {
			return fmt.Errorf(
				"trace fetch %d identity (%s, %q, %q) does not match query plan fetch %d (%s, %q, %q)",
				i+1, traceFetch.Kind, traceFetch.Path, traceFetch.SourceName,
				planFetch.fetchID, planFetch.kind, planFetch.path, planFetch.subgraph,
			)
		}
		if traceFetch.Trace == nil {
			return fmt.Errorf("fetch %d (%s) has no singular load trace", planFetch.fetchID, planFetch.subgraph)
		}
		if len(traceFetch.Traces) != 0 {
			return fmt.Errorf("fetch %d (%s) has both singular and legacy plural load traces", planFetch.fetchID, planFetch.subgraph)
		}
		durations[i] = float64(traceFetch.Trace.DurationLoadNano) / float64(time.Millisecond)
	}
	for i, duration := range durations {
		fetches[i].durationsMs = append(fetches[i].durationsMs, duration)
	}
	return nil
}
