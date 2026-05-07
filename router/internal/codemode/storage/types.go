package storage

type OperationKind string

const (
	OperationKindQuery    OperationKind = "Query"
	OperationKindMutation OperationKind = "Mutation"
)

type SessionOp struct {
	// Name is the JS-side identifier exposed to user code as
	// `tools.<Name>`. It is the ShortSHA() projection of the canonical
	// body — content-derived, so two operations with the same body always
	// share an identifier and two operations that yoko hands back under
	// the same document name but with different bodies do not collide.
	Name string
	// Body is the GraphQL operation source text — exactly one named
	// operation per the yoko proto contract.
	Body string
	Kind OperationKind
	// DocumentName is the operation's name as it appears INSIDE Body
	// (yoko's `operation_name` field). The host bridge passes this — not
	// Name — as `operationName` when invoking the operation against
	// /graphql, because the router's parser matches the document's
	// literal operation name. Falls back to Name when empty (older
	// sessions, tests that omit the field).
	DocumentName string
	Description  string
}
