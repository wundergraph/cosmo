package otel

import (
	"go.opentelemetry.io/otel/attribute"
	"net"
)

const (
	WgOperationName       = attribute.Key("wg.operation.name")
	WgOperationType       = attribute.Key("wg.operation.type")
	WgOperationContent    = attribute.Key("wg.operation.content")
	WgOperationHash       = attribute.Key("wg.operation.hash")
	WgOperationVariables  = attribute.Key("wg.operation.variables")
	WgOperationProtocol   = attribute.Key("wg.operation.protocol")
	WgComponentName       = attribute.Key("wg.component.name")
	WgClientName          = attribute.Key("wg.client.name")
	WgClientVersion       = attribute.Key("wg.client.version")
	WgRouterVersion       = attribute.Key("wg.router.version")
	WgRouterConfigVersion = attribute.Key("wg.router.config.version")
	WgFederatedGraphID    = attribute.Key("wg.federated_graph.id")
	WgSubgraphID          = attribute.Key("wg.subgraph.id")
	WgSubgraphName        = attribute.Key("wg.subgraph.name")
	// WgRequestError is only used to annotate the request count metric to easily identify errored and non-errored requests
	// with the same metric. This has simplified the query for the error and request count metric in Cloud.
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
	WgVariablesValidationSkipped       = attribute.Key("wg.engine.variables_validation_skipped")
	WgQueryDepth                       = attribute.Key("wg.operation.complexity.query_depth")
	WgQueryTotalFields                 = attribute.Key("wg.operation.complexity.total_fields")
	WgQueryRootFields                  = attribute.Key("wg.operation.complexity.root_fields")
	WgQueryRootFieldAliases            = attribute.Key("wg.operation.complexity.root_fields_aliases")
	WgQueryDepthCacheHit               = attribute.Key("wg.operation.complexity.cache_hit")
	WgResponseCacheControlReasons      = attribute.Key("wg.operation.cache_control_reasons")
	WgResponseCacheControlWarnings     = attribute.Key("wg.operation.cache_control_warnings")
	WgResponseCacheControlExpiration   = attribute.Key("wg.operation.cache_control_expiration")
	WgIsBatchingOperation              = attribute.Key("wg.operation.batching.is_batched")
	WgBatchingOperationsCount          = attribute.Key("wg.operation.batching.operations_count")
	WgBatchingOperationIndex           = attribute.Key("wg.operation.batching.operation_index")
	// HTTPRequestUploadFileCount is the number of files uploaded in a request (Not specified in the OpenTelemetry specification)
	HTTPRequestUploadFileCount = attribute.Key("http.request.upload.file_count")

	WgClientReusedConnection = attribute.Key("wg.http.client.reused_connection")

	// Prometheus Schema Field Usage Attrs

	WgOperationSha256   = attribute.Key("wg.operation.sha256")
	WgGraphQLFieldName  = attribute.Key("wg.graphql.field.name")
	WgGraphQLParentType = attribute.Key("wg.graphql.parent_type")
)

const (
	CacheMetricsOperationTypeAdded   = "added"
	CacheMetricsOperationTypeUpdated = "updated"
	CacheMetricsOperationTypeEvicted = "evicted"

	CacheMetricsRequestTypeHits   = "hits"
	CacheMetricsRequestTypeMisses = "misses"
)

const (
	CacheMetricsCacheTypeAttribute = attribute.Key("cache_type")
	CacheMetricsTypeAttribute      = attribute.Key("type")
	CacheMetricsOperationAttribute = attribute.Key("operation")
)

var (
	RouterServerAttribute    = WgComponentName.String("router-server")
	EngineTransportAttribute = WgComponentName.String("engine-transport")
)

const (
	ServerAddress = attribute.Key("server.address")
	ServerPort    = attribute.Key("server.port")
)

func GetServerAttributes(host string) []attribute.KeyValue {
	parsedHost, parsedPort, err := net.SplitHostPort(host)
	if err != nil {
		// If we are unable to parse the host string
		// (e.g. :- if there was no port attached at all)
		// we skip the server port and just return the host as is
		return []attribute.KeyValue{
			ServerAddress.String(host),
		}
	}

	return []attribute.KeyValue{
		ServerAddress.String(parsedHost),
		ServerPort.String(parsedPort),
	}
}
