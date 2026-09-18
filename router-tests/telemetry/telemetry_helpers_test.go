package telemetry

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
)

func withoutHTTPClientTimingAttributes(attributes []attribute.KeyValue) []attribute.KeyValue {
	filtered := make([]attribute.KeyValue, 0, len(attributes))
	for _, attr := range attributes {
		switch attr.Key {
		case otel.WgClientConnectionAcquireDuration,
			otel.WgClientDNSLookupDuration,
			otel.WgClientTCPConnectDuration,
			otel.WgClientTLSHandshakeDuration,
			otel.WgClientTimeToFirstRequestByte,
			otel.WgClientTimeToFirstByte:
			continue
		default:
			filtered = append(filtered, attr)
		}
	}
	return filtered
}

func asssertAttributesEqual(t *testing.T, attributes attribute.Set, expectedAttributes ...attribute.KeyValue) {
	t.Helper()

	for _, expectedAttribute := range expectedAttributes {
		assert.True(t, attributes.HasValue(expectedAttribute.Key))
		value, ok := attributes.Value(expectedAttribute.Key)
		assert.True(t, ok)
		assert.Equal(t, expectedAttribute.Value, value)
	}
}

func assertHasAttributes(t *testing.T, attributes attribute.Set, expectedAttributes ...attribute.Key) {
	t.Helper()

	for _, expectedAttribute := range expectedAttributes {
		assert.True(t, attributes.HasValue(expectedAttribute))
	}
}

func printAttributeNames(attributes []attribute.KeyValue) {
	for _, attribute := range attributes {
		fmt.Printf("%s: %s\n", attribute.Key, attribute.Value.AsString())
	}
}
