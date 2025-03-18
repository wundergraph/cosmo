package expr

import "github.com/expr-lang/expr/ast"

type visitorKind uint

const (
	usesBodyKey visitorKind = iota
)

// VisitorManager is a struct that holds all the VisitorManager that are used to compile the expressions
// We use a separate struct so that the visitor is passed in to places  will use it that are in the request chain
// this means that they don't have access to compiling expressions in a request by default via the expr manager
type visitorManager struct {
	// contains a list of global visitors that are applicable for all compilations
	globalVisitors map[visitorKind]ast.Visitor
}

func createVisitorManager() *visitorManager {
	return &visitorManager{
		globalVisitors: map[visitorKind]ast.Visitor{
			usesBodyKey: &UsesBody{},
		},
	}
}

func (c *visitorManager) IsBodyUsedInExpressions() bool {
	body := c.globalVisitors[usesBodyKey].(*UsesBody)
	return body.UsesBody
}
