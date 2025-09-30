package expr

import (
	"github.com/expr-lang/expr/ast"
)

// AttributeBucket indicates the highest-priority usage detected in an expression
type AttributeBucket uint8

const (
	BucketDefault AttributeBucket = iota
	BucketAuth
	BucketSha256
	BucketParsingTime
	BucketNameOrType
	BucketPersistedId
	BucketNormalizationTime
	BucketHash
	BucketValidationTime
	BucketPlanningTime
	BucketSubgraph
)

// RequestOperationBucketVisitor inspects nodes and sets Bucket to the highest-priority match
// Priority (low -> high): auth, sha256, parsingTime, name/type, persistedId, normalizationTime,
// hash, validationTime, planningTime, subgraph
type RequestOperationBucketVisitor struct {
	Bucket AttributeBucket
}

func (v *RequestOperationBucketVisitor) setBucketIfHigher(bucket AttributeBucket) {
	if bucket > v.Bucket {
		v.Bucket = bucket
	}
}

func (v *RequestOperationBucketVisitor) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.Bucket == BucketSubgraph {
		return
	}

	// Detect subgraph usage (highest priority)
	if ident, ok := (*baseNode).(*ast.IdentifierNode); ok {
		if ident.Value == "subgraph" {
			v.setBucketIfHigher(BucketSubgraph)
			return
		}
	}

	if member, ok := (*baseNode).(*ast.MemberNode); ok {
		// subgraph.* also qualifies
		if ident, ok := member.Node.(*ast.IdentifierNode); ok && ident.Value == "subgraph" {
			v.setBucketIfHigher(BucketSubgraph)
			return
		}

		// request.auth (lowest priority)
		{
			prop := ""
			switch p := member.Property.(type) {
			case *ast.StringNode:
				prop = p.Value
			case *ast.IdentifierNode:
				prop = p.Value
			}
			if prop == "auth" {
				if reqIdent, ok := member.Node.(*ast.IdentifierNode); ok && reqIdent.Value == ExprRequestKey {
					v.setBucketIfHigher(BucketAuth)
					// no return; higher-priority matches may exist in other nodes
				}
			}
		}

		// request.operation.<prop>
		// Check property first
		propName := ""
		switch p := member.Property.(type) {
		case *ast.StringNode:
			propName = p.Value
		case *ast.IdentifierNode:
			propName = p.Value
		default:
			propName = ""
		}
		if propName == "" {
			return
		}

		// Ensure parent is request.operation
		opMember, ok := member.Node.(*ast.MemberNode)
		if !ok {
			return
		}
		opProp := ""
		switch op := opMember.Property.(type) {
		case *ast.StringNode:
			opProp = op.Value
		case *ast.IdentifierNode:
			opProp = op.Value
		}
		if opProp != "operation" {
			return
		}
		if reqIdent, ok := opMember.Node.(*ast.IdentifierNode); !ok || reqIdent.Value != "request" {
			return
		}

		// Map property to bucket
		switch propName {
		case "sha256Hash":
			v.setBucketIfHigher(BucketSha256)
		case "parsingTime":
			v.setBucketIfHigher(BucketParsingTime)
		case "name", "type":
			v.setBucketIfHigher(BucketNameOrType)
		case "persistedId":
			v.setBucketIfHigher(BucketPersistedId)
		case "normalizationTime":
			v.setBucketIfHigher(BucketNormalizationTime)
		case "hash":
			v.setBucketIfHigher(BucketHash)
		case "validationTime":
			v.setBucketIfHigher(BucketValidationTime)
		case "planningTime":
			v.setBucketIfHigher(BucketPlanningTime)
		}
	}
}
