package core

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// LimitRecursionDepth traverses the selection set and keeps track of how many times each object has been visited
// once an object reaches the maxRecursionDepth limit the traversing will stop and an error will be returned
func LimitRecursionDepth(document, operation *ast.Document, maxRecursionDepth int) error {
	walker := astvisitor.NewWalker(48)

	report := &operationreport.Report{}
	visitor := &recursionDepthLimiter{
		walker:            &walker,
		operation:         operation,
		objectVisited:     make(map[int]int),
		maxRecursionDepth: maxRecursionDepth,
	}
	walker.RegisterSelectionSetVisitor(visitor)
	walker.Walk(document, operation, report)

	if report.HasErrors() {
		return &httpGraphqlError{
			message:    report.Error(),
			statusCode: http.StatusBadRequest,
		}
	}
	return nil
}

type recursionDepthLimiter struct {
	walker            *astvisitor.Walker
	operation         *ast.Document
	objectVisited     map[int]int
	maxRecursionDepth int
}

func (c *recursionDepthLimiter) EnterSelectionSet(ref int) {
	c.objectVisited[c.walker.EnclosingTypeDefinition.Ref]++
	if c.objectVisited[c.walker.EnclosingTypeDefinition.Ref] > c.maxRecursionDepth {
		objectType := c.walker.EnclosingTypeDefinition.NameString(c.operation)
		c.walker.Report.AddExternalError(operationreport.ExternalError{
			Message: fmt.Sprintf("Recursion detected: type '%s' exceeds allowed depth of %d", objectType, c.maxRecursionDepth),
			Path:    c.walker.Path,
		})

		// stop traversing the node any deeper to not waste unnecessary resources and prevent infinite recursion
		c.walker.Stop()
	}
}

func (c *recursionDepthLimiter) LeaveSelectionSet(ref int) {
	// subtract from object depth so that the objects on the same depth level will not be added up
	c.objectVisited[c.walker.EnclosingTypeDefinition.Ref]--
}
