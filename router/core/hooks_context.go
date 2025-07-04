package core

// context interface for every hook
type ApplicationStartHookContext interface {
	RequestContext
}

type ApplicationStopHookContext interface {
	RequestContext
}

type GraphQLServerStartHookContext interface {
	RequestContext
}

type GraphQLServerStopHookContext interface {
	RequestContext
}

type RouterRequestHookContext interface {
	RequestContext
}

type RouterResponseHookContext interface {
	RequestContext
}

type SubgraphRequestHookContext interface {
	RequestContext
}

type SubgraphResponseHookContext interface {
	RequestContext
}

type OperationPreParseHookContext interface {
	RequestContext
}

type OperationPostParseHookContext interface {
	RequestContext
}

type OperationPreNormalizeHookContext interface {
	RequestContext
}

type OperationPostNormalizeHookContext interface {
	RequestContext
}

type OperationPreValidateHookContext interface {
	RequestContext
}

type OperationPostValidateHookContext interface {
	RequestContext
}

type OperationPrePlanHookContext interface {
	RequestContext
}

type OperationPostPlanHookContext interface {
	RequestContext
}

type OperationPreExecuteHookContext interface {
	RequestContext
}

type OperationPostExecuteHookContext interface {
	RequestContext
}

