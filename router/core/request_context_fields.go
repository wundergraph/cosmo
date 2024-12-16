package core

import (
	"fmt"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
	"strconv"
	"time"
)

// Context field names used to expose information about the operation being executed.
const (
	ContextFieldOperationName              = "operation_name"
	ContextFieldOperationHash              = "operation_hash"
	ContextFieldOperationType              = "operation_type"
	ContextFieldOperationServices          = "operation_service_names"
	ContextFieldGraphQLErrorCodes          = "graphql_error_codes"
	ContextFieldGraphQLErrorServices       = "graphql_error_service_names"
	ContextFieldOperationParsingTime       = "operation_parsing_time"
	ContextFieldOperationValidationTime    = "operation_validation_time"
	ContextFieldOperationPlanningTime      = "operation_planning_time"
	ContextFieldOperationNormalizationTime = "operation_normalization_time"
	ContextFieldPersistedOperationSha256   = "persisted_operation_sha256"
	ContextFieldOperationSha256            = "operation_sha256"
	ContextFieldResponseErrorMessage       = "response_error_message"
	ContextFieldRequestError               = "request_error"
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

func NewBoolLogField(val bool, attribute config.CustomAttribute) zap.Field {
	if val {
		return zap.Bool(attribute.Key, val)
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

func AccessLogsFieldHandler(attributes []config.CustomAttribute, err any, request *http.Request, responseHeader *http.Header) []zapcore.Field {
	resFields := make([]zapcore.Field, 0, len(attributes))

	var reqContext *requestContext
	if request != nil {
		reqContext = getRequestContext(request.Context())
		resFields = append(resFields, logging.WithRequestID(middleware.GetReqID(request.Context())))
	}

	for _, field := range attributes {
		if field.ValueFrom != nil && field.ValueFrom.ResponseHeader != "" && responseHeader != nil {
			resFields = append(resFields, NewStringLogField(responseHeader.Get(field.ValueFrom.ResponseHeader), field))
		} else if field.ValueFrom != nil && field.ValueFrom.RequestHeader != "" && request != nil {
			resFields = append(resFields, NewStringLogField(request.Header.Get(field.ValueFrom.RequestHeader), field))
		} else if field.ValueFrom != nil && field.ValueFrom.ContextField != "" {
			if v := GetLogFieldFromCustomAttribute(field, reqContext, err); v != zap.Skip() {
				resFields = append(resFields, v)
			}
		} else if field.Default != "" {
			resFields = append(resFields, NewStringLogField(field.Default, field))
		}
	}

	return resFields
}

func GetLogFieldFromCustomAttribute(field config.CustomAttribute, req *requestContext, err any) zap.Field {
	val := getCustomDynamicAttributeValue(field.ValueFrom, req, err)
	switch v := val.(type) {
	case string:
		return NewStringLogField(v, field)
	case bool:
		return NewBoolLogField(v, field)
	case []string:
		return NewStringSliceLogField(v, field)
	case time.Duration:
		return NewDurationLogField(v, field)
	}

	return zap.Skip()
}

func getCustomDynamicAttributeValue(attribute *config.CustomDynamicAttribute, reqContext *requestContext, err any) interface{} {
	if attribute == nil || attribute.ContextField == "" {
		return ""
	}

	if reqContext == nil {
		// If the request context is nil, we can only return the error state.
		if attribute.ContextField == ContextFieldRequestError {
			return err != nil
		} else if attribute.ContextField == ContextFieldResponseErrorMessage && err != nil {
			return fmt.Sprintf("%v", err)
		}
		return ""
	}

	switch attribute.ContextField {
	case ContextFieldRequestError:
		return err != nil || reqContext.error != nil
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
		if err != nil {
			return fmt.Sprintf("%v", err)
		}
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
