package expr

import "github.com/expr-lang/expr/ast"

type visitorKind uint

const (
	usesRequestBodyKey visitorKind = iota
	usesSubgraphTraceKey
	usesResponseBodyKey
	usesSubgraphResponseBodyKey
)

// VisitorGroup is a struct that holds all the VisitorManager that are used to compile the expressions
// We use a separate struct so that the visitor is passed in to places  will use it that are in the request chain
// this means that they don't have access to compiling expressions in a request by default via the expr manager
type VisitorGroup struct {
	// contains a list of global visitors that are applicable for all compilations
	globalVisitors map[visitorKind]ast.Visitor
}

func createVisitorGroup() *VisitorGroup {
	return &VisitorGroup{
		globalVisitors: map[visitorKind]ast.Visitor{
			usesRequestBodyKey:          &UsesBody{},
			usesSubgraphTraceKey:        &UsesSubgraphTrace{},
			usesResponseBodyKey:         &UsesResponseBody{},
			usesSubgraphResponseBodyKey: &UsesSubgraphResponseBody{},
		},
	}
}

func (c *VisitorGroup) IsRequestBodyUsedInExpressions() bool {
	if c == nil {
		return true
	}
	body := c.globalVisitors[usesRequestBodyKey].(*UsesBody)
	return body.UsesBody
}

func (c *VisitorGroup) IsSubgraphTraceUsedInExpressions() bool {
	if c == nil {
		return true
	}
	body := c.globalVisitors[usesSubgraphTraceKey].(*UsesSubgraphTrace)
	return body.UsesSubgraphTrace
}

func (c *VisitorGroup) IsResponseBodyUsedInExpressions() bool {
	if c == nil {
		return true
	}
	body := c.globalVisitors[usesResponseBodyKey].(*UsesResponseBody)
	return body.UsesResponseBody
}

func (c *VisitorGroup) IsSubgraphResponseBodyUsedInExpressions() bool {
	if c == nil {
		return true
	}
	body := c.globalVisitors[usesSubgraphResponseBodyKey].(*UsesSubgraphResponseBody)
	return body.UsesSubgraphResponseBody
}
