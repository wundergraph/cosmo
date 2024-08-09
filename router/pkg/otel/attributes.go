package otel

import (
	"go.opentelemetry.io/otel/attribute"
)

const (
	WgOperationName                    = attribute.Key("wg.operation.name")
	WgOperationType                    = attribute.Key("wg.operation.type")
	WgOperationContent                 = attribute.Key("wg.operation.content")
	WgOperationHash                    = attribute.Key("wg.operation.hash")
	WgOperationVariables               = attribute.Key("wg.operation.variables")
	WgOperationProtocol                = attribute.Key("wg.operation.protocol")
	WgComponentName                    = attribute.Key("wg.component.name")
	WgClientName                       = attribute.Key("wg.client.name")
	WgClientVersion                    = attribute.Key("wg.client.version")
	WgRouterVersion                    = attribute.Key("wg.router.version")
	WgRouterConfigVersion              = attribute.Key("wg.router.config.version")
	WgFederatedGraphID                 = attribute.Key("wg.federated_graph.id")
	WgSubgraphID                       = attribute.Key("wg.subgraph.id")
	WgSubgraphName                     = attribute.Key("wg.subgraph.name")
	WgRequestError                     = attribute.Key("wg.request.error")
	WgOperationPersistedID             = attribute.Key("wg.operation.persisted_id")
	WgEnginePlanCacheHit               = attribute.Key("wg.engine.plan_cache_hit")
	WgEnginePersistedOperationCacheHit = attribute.Key("wg.engine.persisted_operation_cache_hit")
	WgEngineRequestTracingEnabled      = attribute.Key("wg.engine.request_tracing_enabled")
	WgRouterRootSpan                   = attribute.Key("wg.router.root_span")
	WgRouterClusterName                = attribute.Key("wg.router.cluster.name")
	WgSubgraphErrorExtendedCode        = attribute.Key("wg.subgraph.error.extended_code")
	WgSubgraphErrorMessage             = attribute.Key("wg.subgraph.error.message")
	WgFeatureFlag                      = attribute.Key("wg.feature_flag")
	WgAcquireResolverWaitTimeMs        = attribute.Key("wg.engine.resolver.wait_time_ms")
	WgNormalizationCacheHit            = attribute.Key("wg.engine.normalization_cache_hit")
	WgValidationCacheHit               = attribute.Key("wg.engine.validation_cache_hit")
	// HTTPRequestUploadFileCount is the number of files uploaded in a request (Not specified in the OpenTelemetry specification)
	HTTPRequestUploadFileCount = attribute.Key("http.request.upload.file_count")
)

var (
	RouterServerAttribute    = WgComponentName.String("router-server")
	EngineTransportAttribute = WgComponentName.String("engine-transport")
)
