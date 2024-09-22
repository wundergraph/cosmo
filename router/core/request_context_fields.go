package core

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"strconv"
	"time"
)

// Context field names used to expose information about the operation being executed.
const (
	OperationNameContextField              = "operation_name"
	OperationHashContextField              = "operation_hash"
	OperationTypeContextField              = "operation_type"
	GraphQLErrorCodesContextField          = "graphql_error_codes"
	GraphQLErrorServicesContextField       = "graphql_error_service_names"
	OperationParsingTimeContextField       = "operation_parsing_time"
	OperationValidationTimeContextField    = "operation_validation_time"
	OperationPlanningTimeContextField      = "operation_planning_time"
	OperationNormalizationTimeContextField = "operation_normalization_time"
	PersistedOperationSha256ContextField   = "persisted_operation_sha256"
)

// Helper functions to create zap fields for custom attributes.

func NewStringLogField(val string, attribute config.CustomAttribute) zap.Field {
	if v := val; v != "" {
		return zap.String(attribute.Key, v)
	} else if attribute.Default != "" {
		return zap.String(attribute.Key, attribute.Default)
	}
	return zap.Skip()
}

func NewStringSliceLogField(val []string, attribute config.CustomAttribute) zap.Field {
	if v := val; len(v) > 0 {
		return zap.Strings(attribute.Key, v)
	} else if attribute.Default != "" {
		return zap.String(attribute.Key, attribute.Default)
	}
	return zap.Skip()
}

func NewDurationLogField(val time.Duration, attribute config.CustomAttribute) zap.Field {
	if v := val; v > 0 {
		return zap.Duration(attribute.Key, v)
	} else if attribute.Default != "" {
		if v, err := strconv.ParseFloat(attribute.Default, 64); err == nil {
			return zap.Duration(attribute.Key, time.Duration(v))
		}
	}
	return zap.Skip()
}
