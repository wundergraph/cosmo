package core

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
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
	ContextFieldRouterConfigVersion        = "router_config_version"
)

// Helper functions to create zap fields for custom attributes.

func NewExpressionLogField(val any, key string, defaultValue any) zap.Field {
	// Depending on the condition exprlang will dereference a pointer or a non pointer type
	// of the error (if an error is existing), thus if the method receiver is of the pointer
	// type, the Error() wont be printed to the output
	// By wrapping all errors in a common type we can always unwrap it (some types wont be exported
	// like errors.joinErrors for example), and ensure its Error() function is then called
	if assertVal, ok := val.(ExprWrapError); ok {
		val = &assertVal
	}

	if v := val; v != "" {
		return zap.Any(key, v)
	} else if defaultValue != "" {
		return zap.Any(key, defaultValue)
	}
	return zap.Skip()
}

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

func RouterAccessLogsFieldHandler(
	logger *zap.Logger,
	attributes []config.CustomAttribute,
	exprAttributes []requestlogger.ExpressionAttribute,
	passedErr any,
	request *http.Request,
	responseHeader *http.Header,
	_ *expr.Context,
) []zapcore.Field {
	resFields := make([]zapcore.Field, 0, len(attributes))

	reqContext, resFields := processRequestIDField(request, resFields)
	resFields = processCustomAttributes(attributes, responseHeader, resFields, request, reqContext, passedErr)

	if reqContext != nil {
		copyContext := reqContext.expressionContext.Clone()
		copyContext.Request.Error = WrapExprError(reqContext.expressionContext.Request.Error)
		resFields = processExpressionAttributes(logger, exprAttributes, resFields, copyContext)
	}

	return resFields
}

func SubgraphAccessLogsFieldHandler(
	logger *zap.Logger,
	attributes []config.CustomAttribute,
	exprAttributes []requestlogger.ExpressionAttribute,
	passedErr any,
	request *http.Request,
	responseHeader *http.Header,
	overrideExprCtx *expr.Context,
) []zapcore.Field {
	resFields := make([]zapcore.Field, 0, len(attributes))

	reqContext, resFields := processRequestIDField(request, resFields)
	resFields = processCustomAttributes(attributes, responseHeader, resFields, request, reqContext, passedErr)
	resFields = processExpressionAttributes(logger, exprAttributes, resFields, overrideExprCtx)

	return resFields
}

func processRequestIDField(request *http.Request, resFields []zapcore.Field) (*requestContext, []zapcore.Field) {
	var reqContext *requestContext
	if request == nil {
		return reqContext, resFields
	}

	reqContext = getRequestContext(request.Context())
	resFields = append(resFields, logging.WithRequestID(middleware.GetReqID(request.Context())))

	if batchedOperationId, ok := request.Context().Value(BatchedOperationId{}).(string); ok {
		resFields = append(resFields, logging.WithBatchedRequestOperationID(batchedOperationId))
	}

	return reqContext, resFields
}

func processExpressionAttributes(
	logger *zap.Logger,
	exprAttributes []requestlogger.ExpressionAttribute,
	resFields []zapcore.Field,
	overrideExprContext *expr.Context,
) []zapcore.Field {
	for _, exprField := range exprAttributes {
		result, err := expr.ResolveAnyExpression(exprField.Expr, *overrideExprContext)
		if err != nil {
			logger.Error("unable to process expression for access logs", zap.String("fieldKey", exprField.Key), zap.Error(err))
			continue
		}
		resFields = append(resFields, NewExpressionLogField(result, exprField.Key, exprField.Default))
	}
	return resFields
}

func processCustomAttributes(
	attributes []config.CustomAttribute,
	responseHeader *http.Header,
	resFields []zapcore.Field,
	request *http.Request,
	reqContext *requestContext,
	passedErr any,
) []zapcore.Field {
	for _, field := range attributes {
		if field.ValueFrom != nil && field.ValueFrom.ResponseHeader != "" && responseHeader != nil {
			resFields = append(resFields, NewStringLogField(responseHeader.Get(field.ValueFrom.ResponseHeader), field))
		} else if field.ValueFrom != nil && field.ValueFrom.RequestHeader != "" && request != nil {
			resFields = append(resFields, NewStringLogField(request.Header.Get(field.ValueFrom.RequestHeader), field))
		} else if field.ValueFrom != nil && field.ValueFrom.ContextField != "" {
			if v := GetLogFieldFromCustomAttribute(field, reqContext, passedErr); v != zap.Skip() {
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

func getCustomDynamicAttributeValue(
	attribute *config.CustomDynamicAttribute,
	reqContext *requestContext,
	err any,
) interface{} {
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
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.Name()
	case ContextFieldOperationType:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.Type()
	case ContextFieldOperationPlanningTime:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.planningTime
	case ContextFieldOperationNormalizationTime:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.normalizationTime
	case ContextFieldOperationParsingTime:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.parsingTime
	case ContextFieldOperationValidationTime:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.validationTime
	case ContextFieldOperationSha256:
		if reqContext.operation == nil {
			return ""
		}
		return reqContext.operation.sha256Hash
	case ContextFieldOperationHash:
		if reqContext.operation == nil {
			return ""
		}
		if reqContext.operation.hash != 0 {
			return reqContext.operation.HashString()
		}
		return reqContext.operation.Hash()
	case ContextFieldPersistedOperationSha256:
		if reqContext.operation == nil {
			return ""
		}
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
