package core

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
)

// InlineArgument identifies an offending argument by name and value kind. Positions
// are omitted: the normalized document they would refer to is re-parsed on a cache
// hit, so they would not reliably map to the text the client submitted.
type InlineArgument struct {
	Name      string `json:"argument"`
	ValueKind string `json:"valueKind"`
}

type InlineArgumentsChecker struct {
	mode                       config.DisallowInlineArgumentsMode
	enforceHTTPStatusCode      int
	errorCode                  string
	errorMessage               string
	includePersistedOperations bool
}

func NewInlineArgumentsChecker(cfg config.DisallowInlineArguments) (*InlineArgumentsChecker, error) {
	switch cfg.Mode {
	case config.DisallowInlineArgumentsModeOff, "":
		return nil, nil
	case config.DisallowInlineArgumentsModeWarn, config.DisallowInlineArgumentsModeEnforce:
	default:
		// Environment variables bypass the config JSON-schema enum validation, which only
		// runs against the YAML bytes; without this check an unrecognized mode would fall
		// through to warn behavior while the operator believes enforce is active.
		return nil, fmt.Errorf("invalid security.disallow_inline_arguments.mode %q, expected one of %q, %q, %q",
			cfg.Mode, config.DisallowInlineArgumentsModeOff, config.DisallowInlineArgumentsModeWarn, config.DisallowInlineArgumentsModeEnforce)
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
	// Mirrors the JSON-schema bounds, which env vars bypass just like the mode enum
	// above; without this check an out-of-range code would panic in net/http's
	// WriteHeader on every enforce-mode rejection.
	if statusCode < 200 || statusCode > 599 {
		return nil, fmt.Errorf("invalid security.disallow_inline_arguments.enforce_http_status_code %d, expected a value between 200 and 599", statusCode)
	}
	return &InlineArgumentsChecker{
		mode:                       cfg.Mode,
		enforceHTTPStatusCode:      statusCode,
		errorCode:                  errorCode,
		errorMessage:               errorMessage,
		includePersistedOperations: cfg.IncludePersistedOperations,
	}, nil
}

// needsRegisteredOperationClassification reports whether the policy consumes the
// registered/APQ distinction on persisted operations. False when the policy is off
// (nil checker) or when registered operations are checked like everything else,
// letting the persisted operation fetch skip the registered-storage lookup for
// self-contained body+hash requests.
func (c *InlineArgumentsChecker) needsRegisteredOperationClassification() bool {
	return c != nil && !c.includePersistedOperations
}

// InlineArgumentsResult reports the outcome of a Check.
// Count is the number of inline arguments found (also when the operation is rejected),
// Annotation is the pre-built extensions.inlineArguments JSON in warn mode.
type InlineArgumentsResult struct {
	Count      int
	Annotation []byte
}

// CheckInlineArguments runs the disallow-inline-arguments policy check on the kit's
// current document, after NormalizeOperation and before NormalizeVariables (see detectInlineArguments).
// It is a no-op when the feature is disabled (no checker configured on the processor).
func (o *OperationKit) CheckInlineArguments(clientInfo *ClientInfo, logger *zap.Logger) (InlineArgumentsResult, *inlineArgumentsError) {
	checker := o.operationProcessor.inlineArgumentsChecker
	if checker == nil {
		return InlineArgumentsResult{}, nil
	}
	return checker.Check(o.parsedOperation, o.kit.doc, o.operationProcessor.executor.ClientSchema, clientInfo, logger)
}

// Check walks the operation document for non-variable argument values.
// Warn mode returns a pre-built annotation JSON for the extensions.inlineArguments response field.
// Enforce mode returns an error for immediate rejection.
func (c *InlineArgumentsChecker) Check(op *ParsedOperation, doc, definition *ast.Document, clientInfo *ClientInfo, logger *zap.Logger) (InlineArgumentsResult, *inlineArgumentsError) {
	// Only operations whose content was registered in persisted operation storage are
	// exempt. IsPersistedOperation would be too broad: it is set on mere presence of a
	// persistedQuery hash, including APQ operations, whose hashes are client-computed
	// and therefore carry no operator intent.
	if op.IsRegisteredPersistedOperation && !c.includePersistedOperations {
		return InlineArgumentsResult{}, nil
	}

	args := detectInlineArguments(doc, definition)
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

	result.Annotation = marshalInlineArgumentsExtension(c.errorCode, c.errorMessage, args, logger)
	return result, nil
}

// marshalInlineArgumentsExtension builds the extensions.inlineArguments payload shared
// by the warn-mode annotation and both enforce-mode error responses, or nil when
// marshalling fails (logged; the surrounding response is still delivered).
func marshalInlineArgumentsExtension(code, message string, args []InlineArgument, logger *zap.Logger) json.RawMessage {
	payload, err := json.Marshal(inlineArgumentsExtension{
		Code:      code,
		Message:   message,
		Arguments: args,
	})
	if err != nil {
		if logger != nil {
			logger.Error("failed to marshal inlineArguments extension", zap.Error(err))
		}
		return nil
	}
	return payload
}

// inlineArgumentsExtension is the extensions.inlineArguments payload, shared by the
// warn-mode response annotation and the enforce-mode error response.
type inlineArgumentsExtension struct {
	Code      string           `json:"code"`
	Message   string           `json:"message"`
	Arguments []InlineArgument `json:"arguments"`
}

// detectInlineArguments walks the operation document and collects arguments with
// non-variable values. It expects the normalized, pre-extraction document (after
// NormalizeOperation, before NormalizeVariables): non-executed sibling operations,
// unused fragments and static @skip/@include are already pruned, while inline
// literals are not yet extracted into variables. It must walk rather than scan the
// flat doc.Arguments slice, which keeps pruned nodes orphaned on a normalization
// cache miss but is re-parsed clean on a hit.
func detectInlineArguments(doc, definition *ast.Document) []InlineArgument {
	walker := astvisitor.WalkerFromPool()
	defer walker.Release()
	visitor := &inlineArgumentsVisitor{operation: doc}
	walker.RegisterEnterArgumentVisitor(visitor)
	// Walk errors can only stem from a schema-invalid operation, whose
	// schema-validation error takes precedence over this policy check anyway.
	walker.Walk(doc, definition, &operationreport.Report{})
	return visitor.args
}

type inlineArgumentsVisitor struct {
	operation *ast.Document
	args      []InlineArgument
}

func (v *inlineArgumentsVisitor) EnterArgument(ref int) {
	arg := v.operation.Arguments[ref]
	if arg.Value.Kind == ast.ValueKindVariable {
		return
	}
	v.args = append(v.args, InlineArgument{
		Name:      v.operation.ArgumentNameString(ref),
		ValueKind: valueKindName(arg.Value.Kind),
	})
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

// inlineArgumentsError satisfies HttpError so the shared error-dispatch paths
// (getErrorCodes, transport error writers) pick up its code and status without
// type-specific branches; only the nested extensions rendering below is bespoke.
var _ HttpError = (*inlineArgumentsError)(nil)

func (e *inlineArgumentsError) Error() string         { return e.message }
func (e *inlineArgumentsError) Message() string       { return e.message }
func (e *inlineArgumentsError) ExtensionCode() string { return e.code }
func (e *inlineArgumentsError) StatusCode() int       { return e.statusCode }

// graphqlError returns the error in response shape, shared by the HTTP and
// WebSocket transports: the extensions carry both the flat code that clients
// and APM tooling use for classification and the full details under
// inlineArguments (nil when marshalling fails; code and message still reach
// the client).
func (e *inlineArgumentsError) graphqlError(logger *zap.Logger) graphqlError {
	return graphqlError{
		Message: e.message,
		Extensions: &Extensions{
			Code:            e.code,
			InlineArguments: marshalInlineArgumentsExtension(e.code, e.message, e.arguments, logger),
		},
	}
}

func writeInlineArgumentsError(r *http.Request, w http.ResponseWriter, e *inlineArgumentsError, logger *zap.Logger, headerPropagation *HeaderPropagation) {
	body, err := json.Marshal(struct {
		Errors []graphqlError `json:"errors"`
	}{
		Errors: []graphqlError{e.graphqlError(logger)},
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
