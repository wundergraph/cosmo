package core

type OperationBlocker struct {
	blockMutations     bool
	blockSubscriptions bool
}

type OperationBlockerOptions struct {
	BlockMutations     bool
	BlockSubscriptions bool
}

func NewOperationBlocker(opts *OperationBlockerOptions) *OperationBlocker {
	return &OperationBlocker{
		blockMutations:     opts.BlockMutations,
		blockSubscriptions: opts.BlockSubscriptions,
	}
}

func (o *OperationBlocker) OperationIsBlocked(operationType string) bool {
	if operationType == "mutation" {
		return o.blockMutations
	}

	if operationType == "subscription" {
		return o.blockSubscriptions
	}

	return false
}
