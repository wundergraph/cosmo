package storage

type OperationKind string

const (
	OperationKindQuery    OperationKind = "Query"
	OperationKindMutation OperationKind = "Mutation"
)

type SessionOp struct {
	Name        string
	Body        string
	Kind        OperationKind
	Description string
}
