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

func GetLogFieldFromCustomAttribute(field config.CustomAttribute, req RequestContext) zap.Field {
	val := GetCustomDynamicAttributeValue(field.ValueFrom, req)
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

func GetCustomDynamicAttributeValue(attribute *config.CustomDynamicAttribute, req RequestContext) interface{} {
	if attribute.ContextField == "" {
		return ""
	}

	operation := req.Operation()
	op, opOk := operation.(*operationContext)
	reqContext, reqOk := req.(*requestContext)

	switch attribute.ContextField {
	case ContextFieldOperationName:
		return operation.Name()
	case ContextFieldOperationType:
		return operation.Type()
	case ContextFieldOperationPlanningTime:
		if opOk {
			return op.planningTime
		}
	case ContextFieldOperationNormalizationTime:
		if opOk {
			return op.normalizationTime
		}
	case ContextFieldOperationParsingTime:
		if opOk {
			return op.parsingTime
		}
	case ContextFieldOperationValidationTime:
		if opOk {
			return op.validationTime
		}
	case ContextFieldOperationSha256:
		if opOk {
			return op.sha256Hash
		}
	case ContextFieldOperationHash:
		if opOk && op.hash != 0 {
			return strconv.FormatUint(op.hash, 10)
		}
		return operation.Hash()
	case ContextFieldPersistedOperationSha256:
		if opOk {
			return op.persistedID
		}
	case ContextFieldResponseErrorMessage:
		if reqOk && reqContext.error != nil {
			return reqContext.error.Error()
		}
	case ContextFieldOperationServices:
		if reqOk {
			return reqContext.dataSourceNames
		}
	case ContextFieldGraphQLErrorServices:
		if reqOk {
			return reqContext.graphQLErrorServices
		}
	case ContextFieldGraphQLErrorCodes:
		if reqOk {
			return reqContext.graphQLErrorCodes
		}
	}

	return ""
}
