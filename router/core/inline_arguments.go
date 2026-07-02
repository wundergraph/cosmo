package core

import (
	"encoding/json"
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

type InlineArgument struct {
	Name      string `json:"argument"`
	ValueKind string `json:"valueKind"`
	Line      uint32 `json:"line"`
	Column    uint32 `json:"column"`
}

type InlineArgumentsChecker struct {
	mode                       config.DisallowInlineArgumentsMode
	enforceHTTPStatusCode      int
	errorCode                  string
	errorMessage               string
	includePersistedOperations bool
}

func NewInlineArgumentsChecker(cfg config.DisallowInlineArguments) *InlineArgumentsChecker {
	if cfg.Mode == config.DisallowInlineArgumentsModeOff || cfg.Mode == "" {
		return nil
	}
	errorCode := cfg.ErrorCode
	if errorCode == "" {
		errorCode = ExtCodeErrInlineArgumentValuesNotAllowed
	}
	errorMessage := cfg.ErrorMessage
	if errorMessage == "" {
		errorMessage = "Inline argument values are not allowed. Use variables instead."
	}
	statusCode := cfg.EnforceHTTPStatusCode
	if statusCode == 0 {
		statusCode = http.StatusBadRequest
	}
	return &InlineArgumentsChecker{
		mode:                       cfg.Mode,
		enforceHTTPStatusCode:      statusCode,
		errorCode:                  errorCode,
		errorMessage:               errorMessage,
		includePersistedOperations: cfg.IncludePersistedOperations,
	}
}

// InlineArgumentsResult reports the outcome of a Check.
// Count is the number of inline arguments found (also when the operation is rejected),
// Annotation is the pre-built extensions.inlineArguments JSON in warn mode.
type InlineArgumentsResult struct {
	Count      int
	Annotation []byte
}

// Check scans doc.Arguments for non-variable values.
// Warn mode returns a pre-built annotation JSON for the extensions.inlineArguments response field.
// Enforce mode returns an error for immediate rejection.
func (c *InlineArgumentsChecker) Check(op *ParsedOperation, doc *ast.Document, clientInfo *ClientInfo, logger *zap.Logger) (InlineArgumentsResult, *inlineArgumentsError) {
	if op.IsPersistedOperation && !c.includePersistedOperations {
		return InlineArgumentsResult{}, nil
	}

	args := detectInlineArguments(doc)
	if len(args) == 0 {
		return InlineArgumentsResult{}, nil
	}
	result := InlineArgumentsResult{Count: len(args)}

	if ce := logger.Check(zap.WarnLevel, "inline arguments found in operation"); ce != nil {
		names := make([]string, len(args))
		for i, arg := range args {
			names[i] = arg.Name
		}
		fields := []zap.Field{
			zap.Int("count", len(args)),
			zap.Strings("arguments", names),
			zap.String("operation_name", op.Request.OperationName),
		}
		if clientInfo != nil {
			fields = append(fields,
				zap.String("client_name", clientInfo.Name),
				zap.String("client_version", clientInfo.Version),
			)
		}
		ce.Write(fields...)
	}

	if c.mode == config.DisallowInlineArgumentsModeEnforce {
		return result, &inlineArgumentsError{
			message:    c.errorMessage,
			code:       c.errorCode,
			statusCode: c.enforceHTTPStatusCode,
			arguments:  args,
		}
	}

	// Subscriptions stream their responses, so there is no single response body
	// to annotate; the warn log and span attribute still cover them.
	if op.Type == "subscription" {
		return result, nil
	}

	annotation, err := json.Marshal(inlineArgumentsExtension{
		Code:      c.errorCode,
		Message:   c.errorMessage,
		Arguments: args,
	})
	if err != nil {
		logger.Error("failed to marshal inlineArguments annotation", zap.Error(err))
		return result, nil
	}
	result.Annotation = annotation
	return result, nil
}

// inlineArgumentsExtension is the extensions.inlineArguments payload, shared by the
// warn-mode response annotation and the enforce-mode error response.
type inlineArgumentsExtension struct {
	Code      string           `json:"code"`
	Message   string           `json:"message"`
	Arguments []InlineArgument `json:"arguments"`
}

// detectInlineArguments scans the flat doc.Arguments slice, which the parser populates
// before any normalization stage can rewrite or prune arguments.
func detectInlineArguments(doc *ast.Document) []InlineArgument {
	var result []InlineArgument
	for ref := range doc.Arguments {
		arg := doc.Arguments[ref]
		if arg.Value.Kind == ast.ValueKindVariable {
			continue
		}
		result = append(result, InlineArgument{
			Name:      doc.ArgumentNameString(ref),
			ValueKind: valueKindName(arg.Value.Kind),
			Line:      arg.Position.LineStart,
			Column:    arg.Position.CharStart,
		})
	}
	return result
}

func valueKindName(k ast.ValueKind) string {
	switch k {
	case ast.ValueKindString:
		return "String"
	case ast.ValueKindBoolean:
		return "Boolean"
	case ast.ValueKindInteger:
		return "Int"
	case ast.ValueKindFloat:
		return "Float"
	case ast.ValueKindNull:
		return "Null"
	case ast.ValueKindList:
		return "List"
	case ast.ValueKindObject:
		return "Object"
	case ast.ValueKindEnum:
		return "Enum"
	default:
		return "Unknown"
	}
}

type inlineArgumentsError struct {
	message    string
	code       string
	statusCode int
	arguments  []InlineArgument
}

func (e *inlineArgumentsError) Error() string { return e.message }

// extensionJSON returns the extensions.inlineArguments payload for this error,
// or nil when marshalling fails (the error code and message still reach the client).
func (e *inlineArgumentsError) extensionJSON(logger *zap.Logger) json.RawMessage {
	payload, err := json.Marshal(inlineArgumentsExtension{
		Code:      e.code,
		Message:   e.message,
		Arguments: e.arguments,
	})
	if err != nil {
		if logger != nil {
			logger.Error("failed to marshal inlineArguments extension", zap.Error(err))
		}
		return nil
	}
	return payload
}

type inlineArgumentsErrorResponse struct {
	Errors []inlineArgumentsErrorEntry `json:"errors"`
}

type inlineArgumentsErrorEntry struct {
	Message    string                         `json:"message"`
	Extensions inlineArgumentsErrorExtensions `json:"extensions"`
}

type inlineArgumentsErrorExtensions struct {
	// Code carries the flat error code that clients and APM tooling use for
	// classification; the full details live under InlineArguments.
	Code            string                   `json:"code"`
	InlineArguments inlineArgumentsExtension `json:"inlineArguments"`
}

func writeInlineArgumentsError(r *http.Request, w http.ResponseWriter, e *inlineArgumentsError, logger *zap.Logger, headerPropagation *HeaderPropagation) {
	body, err := json.Marshal(inlineArgumentsErrorResponse{
		Errors: []inlineArgumentsErrorEntry{{
			Message: e.message,
			Extensions: inlineArgumentsErrorExtensions{
				Code: e.code,
				InlineArguments: inlineArgumentsExtension{
					Code:      e.code,
					Message:   e.message,
					Arguments: e.arguments,
				},
			},
		}},
	})
	if err != nil {
		if logger != nil {
			logger.Error("failed to marshal inline arguments error response", zap.Error(err))
		}
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	writeRawErrorBody(r, w, e.statusCode, body, logger, headerPropagation)
}
