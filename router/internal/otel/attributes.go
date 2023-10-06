package otel

import "go.opentelemetry.io/otel/attribute"

const (
	WgOperationName       = attribute.Key("wg.operation.name")
	WgOperationType       = attribute.Key("wg.operation.type")
	WgOperationContent    = attribute.Key("wg.operation.content")
	WgOperationHash       = attribute.Key("wg.operation.hash")
	WgComponentName       = attribute.Key("wg.component.name")
	WgClientName          = attribute.Key("wg.client.name")
	WgClientVersion       = attribute.Key("wg.client.version")
	WgRouterGraphName     = attribute.Key("wg.router.graph.name")
	WgRouterVersion       = attribute.Key("wg.router.version")
	WgRouterConfigVersion = attribute.Key("wg.router.config.version")
	WgSubgraphID          = attribute.Key("wg.subgraph.id")
	WgSubgraphName        = attribute.Key("wg.subgraph.name")
)

var (
	RouterServerAttribute    = WgComponentName.String("router-server")
	EngineTransportAttribute = WgComponentName.String("engine-transport")
)
