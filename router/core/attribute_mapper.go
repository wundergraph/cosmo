package core

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
)

// attributeMapper maps context attributes to custom attributes.
type attributeMapper struct {
	enabled bool

	// lookupMap contains the default key names, which can be mapped to a new name with custom attributes.
	// These keys are used to identify attributes, which should not be included by default and map to the
	// corresponding fields in the request context.
	lookupMap map[attribute.Key]string
	// contextAttrMap is the map of configured custom context attributes. This map indicates whether attributes are
	// added to the metrics and potentially remapped to a new key. Only attributes from the lookupMap are taken
	// into account.
	contextAttrMap map[string]config.CustomAttribute
}

func newAttributeMapper(enabled bool, attr []config.CustomAttribute) *attributeMapper {
	// Any attributes that are in this map, will be resolved only if they are configured in the `attr` list.
	// This is to avoid adding certain attributes which might cause higher cardinality to the metrics
	// by default as it can be expensive for the metric backend.
	set := map[attribute.Key]string{
		otel.WgOperationName:       ContextFieldOperationName,
		otel.WgOperationHash:       ContextFieldOperationHash,
		otel.WgRouterConfigVersion: ContextFieldRouterConfigVersion,
	}

	attrMap := make(map[string]config.CustomAttribute)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.ContextField != "" {
			attrMap[a.ValueFrom.ContextField] = a
		}
	}

	return &attributeMapper{
		enabled:        enabled,
		contextAttrMap: attrMap,
		lookupMap:      set,
	}
}

func (r *attributeMapper) mapAttributes(attributes []attribute.KeyValue) []attribute.KeyValue {
	if !r.enabled {
		return attributes
	}

	result := make([]attribute.KeyValue, 0, len(attributes))

	for _, attr := range attributes {
		// check if the attribute is defined in the set of default keys
		contextField, exists := r.lookupMap[attr.Key]
		if !exists {
			// if the attribute is not in the default set, we don't expect it to generate high cardinality
			// and can safely add it to the result
			result = append(result, attr)
			continue
		}

		// if the attribute is in the map, we need to check if we want it to be added
		if resolvedAttr := r.mapAttribute(attr, contextField); resolvedAttr.Valid() {
			result = append(result, resolvedAttr)
		}
	}

	return result
}

func (r *attributeMapper) mapAttribute(attr attribute.KeyValue, contextField string) attribute.KeyValue {
	a, exists := r.contextAttrMap[contextField]
	if !exists {
		return attribute.KeyValue{}
	}

	val := attr.Value.AsString()
	if val == "" {
		val = a.Default
	}

	key := a.Key
	if key == "" {
		// if the key should not be remapped we fall back to the default key name
		key = string(attr.Key)
	}

	return attribute.String(key, val)
}
