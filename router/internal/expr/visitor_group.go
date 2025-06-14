package expr

import "github.com/expr-lang/expr/ast"

type visitorKind uint

const (
	usesBodyKey visitorKind = iota
	usesSubgraphTraceKey
)

// VisitorGroup is a struct that holds all the VisitorManager that are used to compile the expressions
// We use a separate struct so that the visitor is passed in to places  will use it that are in the request chain
// this means that they don't have access to compiling expressions in a request by default via the expr manager
type visitorGroup struct {
	// contains a list of global visitors that are applicable for all compilations
	globalVisitors map[visitorKind]ast.Visitor
}

func createVisitorMGroup() *visitorGroup {
	return &visitorGroup{
		globalVisitors: map[visitorKind]ast.Visitor{
			usesBodyKey:          &UsesBody{},
			usesSubgraphTraceKey: &UsesSubgraphTrace{},
		},
	}
}

func (c *visitorGroup) IsBodyUsedInExpressions() bool {
	body := c.globalVisitors[usesBodyKey].(*UsesBody)
	return body.UsesBody
}

func (c *visitorGroup) IsSubgraphTraceUsedInExpressions() bool {
	body := c.globalVisitors[usesSubgraphTraceKey].(*UsesSubgraphTrace)
	return body.UsesSubgraphTrace
}
