package telemetry

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
)

func assertHasAttributes(t *testing.T, attributes attribute.Set, expectedAttributes ...attribute.KeyValue) {
	t.Helper()

	for _, expectedAttribute := range expectedAttributes {
		assert.True(t, attributes.HasValue(expectedAttribute.Key))
		value, ok := attributes.Value(expectedAttribute.Key)
		assert.True(t, ok)
		assert.Equal(t, expectedAttribute.Value, value)
	}
}

func printAttributeNames(attributes []attribute.KeyValue) {
	for _, attribute := range attributes {
		fmt.Printf("%s: %s\n", attribute.Key, attribute.Value.AsString())
	}
}
