package core

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"strconv"
	"time"
)

// Context field names used to expose information about the operation being executed.
const (
	ContextFieldOperationName              = "operation_name"
	ContextFieldOperationHash              = "operation_hash"
	ContextFieldOperationType              = "operation_type"
	ContextFieldOperationServices          = "operation_service_names"
	ContextFieldResponseErrorMessage       = "response_error_message"
	ContextFieldGraphQLErrorCodes          = "graphql_error_codes"
	ContextFieldGraphQLErrorServices       = "graphql_error_service_names"
	ContextFieldOperationParsingTime       = "operation_parsing_time"
	ContextFieldOperationValidationTime    = "operation_validation_time"
	ContextFieldOperationPlanningTime      = "operation_planning_time"
	ContextFieldOperationNormalizationTime = "operation_normalization_time"
	ContextFieldPersistedOperationSha256   = "persisted_operation_sha256"
	ContextFieldOperationSha256            = "operation_sha256"
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

func GetLogFieldFromCustomAttribute(field config.CustomAttribute, req *requestContext) zap.Field {
	val := getCustomDynamicAttributeValue(field.ValueFrom, req)
	switch v := val.(type) {
	case string:
		return NewStringLogField(v, field)
	case []string:
		return NewStringSliceLogField(v, field)
	case time.Duration:
		return NewDurationLogField(v, field)
	}

	return zap.Skip()
}

func getCustomDynamicAttributeValue(attribute *config.CustomDynamicAttribute, reqContext *requestContext) interface{} {
	if attribute.ContextField == "" {
		return ""
	}

	switch attribute.ContextField {
	case ContextFieldOperationName:
		return reqContext.operation.Name()
	case ContextFieldOperationType:
		return reqContext.operation.Type()
	case ContextFieldOperationPlanningTime:
		return reqContext.operation.planningTime
	case ContextFieldOperationNormalizationTime:
		return reqContext.operation.normalizationTime
	case ContextFieldOperationParsingTime:
		return reqContext.operation.parsingTime
	case ContextFieldOperationValidationTime:
		return reqContext.operation.validationTime
	case ContextFieldOperationSha256:
		return reqContext.operation.sha256Hash
	case ContextFieldOperationHash:
		if reqContext.operation.hash != 0 {
			return strconv.FormatUint(reqContext.operation.hash, 10)
		}
		return reqContext.operation.Hash()
	case ContextFieldPersistedOperationSha256:
		return reqContext.operation.persistedID
	case ContextFieldResponseErrorMessage:
		if reqContext.error != nil {
			return reqContext.error.Error()
		}
	case ContextFieldOperationServices:
		return reqContext.dataSourceNames
	case ContextFieldGraphQLErrorServices:
		return reqContext.graphQLErrorServices
	case ContextFieldGraphQLErrorCodes:
		return reqContext.graphQLErrorCodes
	}

	return ""
}
