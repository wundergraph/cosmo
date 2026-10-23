package expr

import "github.com/expr-lang/expr/ast"

// UsesLog identifies access log filters that read the log map, so the map is
// only built for entries when a filter needs it.
type UsesLog struct {
	UsesLog bool
}

func (v *UsesLog) Visit(node *ast.Node) {
	if node == nil || v.UsesLog {
		return
	}

	// $env can read any environment field dynamically, including log.
	if identifierNode, ok := (*node).(*ast.IdentifierNode); ok && (identifierNode.Value == "log" || identifierNode.Value == "$env") {
		v.UsesLog = true
	}
}
