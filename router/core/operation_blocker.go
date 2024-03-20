package core

import (
	"errors"
)

var (
	ErrMutationOperationBlocked     = errors.New("operation type 'mutation' is blocked")
	ErrSubscriptionOperationBlocked = errors.New("operation type 'subscription' is blocked")
	ErrNonPersistedOperationBlocked = errors.New("non-persisted operation is blocked")
)

type OperationBlocker struct {
	blockMutations     bool
	blockSubscriptions bool
	blockNonPersisted  bool
}

type OperationBlockerOptions struct {
	BlockMutations     bool
	BlockSubscriptions bool
	BlockNonPersisted  bool
}

func NewOperationBlocker(opts *OperationBlockerOptions) *OperationBlocker {
	return &OperationBlocker{
		blockMutations:     opts.BlockMutations,
		blockSubscriptions: opts.BlockSubscriptions,
		blockNonPersisted:  opts.BlockNonPersisted,
	}
}

func (o *OperationBlocker) OperationIsBlocked(operation *ParsedOperation) error {

	persisted := operation.PersistedID != ""

	if !persisted && o.blockNonPersisted {
		return ErrNonPersistedOperationBlocked
	}

	switch operation.Type {
	case "mutation":
		if o.blockMutations {
			return ErrMutationOperationBlocked
		}
	case "subscription":
		if o.blockSubscriptions {
			return ErrSubscriptionOperationBlocked
		}
	}
	return nil
}
