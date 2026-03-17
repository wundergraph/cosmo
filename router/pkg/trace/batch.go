package trace

import (
	"net/http"
	"strconv"

	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

func AddBatchTracing(
	r *http.Request,
	bodyBytes []byte,
	clientHeader config.ClientHeader,
	batchOperationsLength int,
	baseOtelAttributes []attribute.KeyValue,
	version string,
	digest *xxhash.Digest,
) {
	rootSpan := trace.SpanFromContext(r.Context())

	_, _ = digest.Write(bodyBytes)
	operationHashBatch := strconv.FormatUint(digest.Sum64(), 10)

	// We need to reset the digest so we can reuse it
	digest.Reset()

	clientName, clientVersion := GetClientDetails(r, clientHeader)

	rootSpan.SetAttributes(baseOtelAttributes...)
	rootSpan.SetAttributes(
		otel.WgIsBatchingOperation.Bool(true),
		otel.WgOperationHash.String(operationHashBatch),
		otel.WgClientName.String(clientName),
		otel.WgClientVersion.String(clientVersion),
		otel.WgBatchingOperationsCount.Int(batchOperationsLength),
		otel.WgRouterConfigVersion.String(version),
	)
}
