package graphql

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/gin-contrib/requestid"
	"github.com/gin-gonic/gin"
	"github.com/wundergraph/cosmo/router/pkg/contextx"
	"github.com/wundergraph/cosmo/router/pkg/flushwriter"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/buger/jsonparser"
	"github.com/dgraph-io/ristretto"
	"github.com/hashicorp/go-multierror"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/cosmo/router/pkg/internal/unsafebytes"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/cosmo/router/pkg/pool"
)

const (
	ErrMsgOperationParseFailed      = "failed to parse operation: %w"
	ErrMsgOperationValidationFailed = "operation validation failed: %s"
)

var (
	couldNotResolveResponseErr = errors.New("could not resolve response")
	internalServerErrorErr     = errors.New("internal server error")
)

type planWithExtractedVariables struct {
	preparedPlan plan.Plan
	variables    []byte
}

func MergeJsonRightIntoLeft(left, right []byte) []byte {
	if len(left) == 0 {
		return right
	}
	if len(right) == 0 {
		return left
	}
	result := gjson.ParseBytes(right)
	result.ForEach(func(key, value gjson.Result) bool {
		left, _ = sjson.SetRawBytes(left, key.Str, unsafebytes.StringToBytes(value.Raw))
		return true
	})
	return left
}

type HandlerOptions struct {
	PlanConfig      plan.Configuration
	Definition      *ast.Document
	Resolver        *resolve.Resolver
	RenameTypeNames []resolve.RenameTypeName
	Pool            *pool.Pool
	Cache           *ristretto.Cache
	Log             *zap.Logger
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		planConfig:      opts.PlanConfig,
		definition:      opts.Definition,
		resolver:        opts.Resolver,
		log:             opts.Log,
		pool:            opts.Pool,
		sf:              &singleflight.Group{},
		prepared:        map[uint64]planWithExtractedVariables{},
		preparedMux:     &sync.RWMutex{},
		renameTypeNames: opts.RenameTypeNames,
		planCache:       opts.Cache,
	}
	return graphQLHandler
}

type GraphQLPlaygroundHandler struct {
	Log     *zap.Logger
	Html    string
	NodeUrl string
}

func (h *GraphQLPlaygroundHandler) Handler(c *gin.Context) {
	tpl := strings.Replace(h.Html, "{{apiURL}}", h.NodeUrl, -1)
	resp := []byte(tpl)

	c.Header("Content-Type", "text/Html; charset=utf-8")
	c.Header("Content-Length", strconv.Itoa(len(resp)))

	c.Status(http.StatusOK)
	_, _ = c.Writer.Write(resp)
}

type GraphQLHandler struct {
	planConfig plan.Configuration
	definition *ast.Document
	resolver   *resolve.Resolver
	log        *zap.Logger
	pool       *pool.Pool
	sf         *singleflight.Group

	prepared    map[uint64]planWithExtractedVariables
	preparedMux *sync.RWMutex

	renameTypeNames []resolve.RenameTypeName

	planCache *ristretto.Cache
}

func (h *GraphQLHandler) Handler(c *gin.Context) {

	var (
		preparedPlan planWithExtractedVariables
	)

	requestLogger := h.log.With(logging.WithRequestID(requestid.Get(c)))

	buf := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(buf)
	_, err := io.Copy(buf, c.Request.Body)
	if err != nil {
		requestLogger.Error("failed to read request body", zap.Error(err))
		c.Status(http.StatusBadRequest)
		h.writeRequestErrors(graphql.RequestErrorsFromError(errors.New("bad request")), c.Writer, requestLogger)
		c.String(http.StatusInternalServerError, "unexpected error")
		return
	}

	body := buf.Bytes()

	requestQuery, _ := jsonparser.GetString(body, "query")
	requestOperationName, _ := jsonparser.GetString(body, "operationName")
	requestVariables, _, _, _ := jsonparser.Get(body, "variables")
	requestOperationType := ""

	shared := h.pool.GetSharedFromRequest(c.Request, h.planConfig, pool.Config{
		RenameTypeNames: h.renameTypeNames,
	})
	defer h.pool.PutShared(shared)
	shared.Ctx.Variables = requestVariables
	shared.Doc.Input.ResetInputString(requestQuery)
	shared.Parser.Parse(shared.Doc, shared.Report)

	// If the operationName is not set, we try to get it from the named operation in the document
	if requestOperationName == "" {
		if len(shared.Doc.OperationDefinitions) == 1 {
			requestOperationName = shared.Doc.Input.ByteSlice(shared.Doc.OperationDefinitions[0].Name).String()
		}
	}

	// If multiple operations are defined, but no operationName is set, we return an error
	if len(shared.Doc.OperationDefinitions) > 1 && requestOperationName == "" {
		requestLogger.Error("operation name is required when multiple operations are defined")
		c.String(http.StatusBadRequest, "operation name is required when multiple operations are defined")
		return
	}

	// Extract the operation type from the first operation that matches the operationName
	for _, op := range shared.Doc.OperationDefinitions {
		if shared.Doc.Input.ByteSlice(op.Name).String() == requestOperationName {
			switch op.OperationType {
			case ast.OperationTypeQuery:
				requestOperationType = "query"
			case ast.OperationTypeMutation:
				requestOperationType = "mutation"
			case ast.OperationTypeSubscription:
				requestOperationType = "subscription"
			}
			break
		}
	}

	// Add the operation to the context, so we can access it later in custom transports etc.
	shared.Ctx = shared.Ctx.WithContext(contextx.AddGraphQLOperationToContext(c.Request.Context(), &contextx.GraphQLOperation{
		Name:    requestOperationName,
		Type:    requestOperationType,
		Content: requestQuery,
	}))

	// Add the operation to the trace span
	span := trace.SpanFromContext(c.Request.Context())
	span.SetAttributes(ctrace.WgOperationName.String(requestOperationName))
	span.SetAttributes(ctrace.WgOperationType.String(requestOperationType))
	span.SetAttributes(ctrace.WgOperationContent.String(requestQuery))

	// Add client info to trace span
	clientName := ctrace.GetClientInfo(c, "graphql-client-name", "apollographql-client-name", "unknown")
	clientVersion := ctrace.GetClientInfo(c, "graphql-client-version", "apollographql-client-version", "missing")
	span.SetAttributes(ctrace.WgClientName.String(clientName))
	span.SetAttributes(ctrace.WgClientVersion.String(clientVersion))

	if shared.Report.HasErrors() {
		h.logInternalErrors(shared.Report, requestLogger)
		c.Status(http.StatusBadRequest)
		h.writeRequestErrorsFromReport(shared.Report, c.Writer, requestLogger)
		return
	}

	requestOperationNameBytes := []byte(requestOperationName)

	if requestOperationName == "" {
		shared.Normalizer.NormalizeOperation(shared.Doc, h.definition, shared.Report)
	} else {
		shared.Normalizer.NormalizeNamedOperation(shared.Doc, h.definition, requestOperationNameBytes, shared.Report)
	}

	if shared.Report.HasErrors() {
		h.logInternalErrors(shared.Report, requestLogger)
		c.Status(http.StatusBadRequest)
		h.writeRequestErrorsFromReport(shared.Report, c.Writer, requestLogger)
		return
	}

	// add the operation name to the hash
	// this is important for multi operation documents to have a different hash for each operation
	// otherwise, the prepared plan cache would return the same plan for all operations
	_, err = shared.Hash.Write(requestOperationNameBytes)
	if err != nil {
		requestLogger.Error("hash write failed", zap.Error(err))
		c.String(http.StatusInternalServerError, "unexpected error")
		return
	}

	// create a hash of the query to use as a key for the prepared plan cache
	// in this hash, we include the printed operation
	// and the extracted variables (see below)
	err = shared.Printer.Print(shared.Doc, h.definition, shared.Hash)
	if err != nil {
		requestLogger.Error("unable to print document", zap.Error(err))
		h.respondWithInternalServerError(c.Writer, requestLogger)
		return
	}

	// add the extracted variables to the hash
	_, err = shared.Hash.Write(shared.Doc.Input.Variables)
	if err != nil {
		requestLogger.Error("hash write failed", zap.Error(err))
		h.respondWithInternalServerError(c.Writer, requestLogger)
		return
	}
	operationID := shared.Hash.Sum64() // generate the operation ID
	shared.Hash.Reset()

	span.SetAttributes(ctrace.WgOperationHash.Int64(int64(operationID)))

	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := h.planCache.Get(operationID)
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		preparedPlan = cachedPlan.(planWithExtractedVariables)
	} else {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		sharedPreparedPlan, err, _ := h.sf.Do(strconv.FormatUint(operationID, 10), func() (interface{}, error) {
			prepared, err := h.preparePlan(requestOperationNameBytes, shared)
			if err != nil {
				return nil, err
			}
			// cache the prepared plan for 1 hour
			h.planCache.SetWithTTL(operationID, prepared, 1, time.Hour)
			return prepared, nil
		})
		if err != nil {
			if shared.Report.HasErrors() {
				c.Status(http.StatusBadRequest)
				h.writeRequestErrorsFromReport(shared.Report, c.Writer, requestLogger)
			} else {
				requestLogger.Error("prepare plan failed", zap.Error(err))
				h.respondWithInternalServerError(c.Writer, requestLogger)
			}
			return
		}

		if sharedPreparedPlan == nil {
			requestLogger.Error("prepare plan is nil", zap.Error(err))
			c.String(http.StatusInternalServerError, "unexpected error")
			return
		}
		preparedPlan = sharedPreparedPlan.(planWithExtractedVariables)
	}

	if len(preparedPlan.variables) != 0 {
		shared.Ctx.Variables = MergeJsonRightIntoLeft(shared.Ctx.Variables, preparedPlan.variables)
	}

	switch p := preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		c.Header("Content-Type", "application/json")

		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)

		err := h.resolver.ResolveGraphQLResponse(shared.Ctx, p.Response, nil, executionBuf)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}

			c.Status(http.StatusInternalServerError)
			h.writeRequestErrors(graphql.RequestErrorsFromError(couldNotResolveResponseErr), c.Writer, requestLogger)
			requestLogger.Error("unable to resolve GraphQL response", zap.Error(err))
			return
		}
		_, err = executionBuf.WriteTo(c.Writer)
		if err != nil {
			requestLogger.Error("respond to client", zap.Error(err))
			return
		}
	case *plan.SubscriptionResponsePlan:
		var (
			flushWriter *flushwriter.HttpFlushWriter
			ok          bool
		)
		shared.Ctx, flushWriter, ok = flushwriter.GetFlushWriter(shared.Ctx, shared.Ctx.Variables, c.Request, c.Writer)
		if !ok {
			requestLogger.Error("connection not flushable")
			c.String(http.StatusInternalServerError, "unexpected error")
			return
		}

		err := h.resolver.ResolveGraphQLSubscription(shared.Ctx, p.Response, flushWriter)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}

			c.Status(http.StatusInternalServerError)
			h.writeRequestErrors(graphql.RequestErrorsFromError(couldNotResolveResponseErr), c.Writer, requestLogger)
			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			return
		}
	case *plan.StreamingResponsePlan:
		c.String(http.StatusInternalServerError, "not implemented")
	}
}

func (h *GraphQLHandler) logInternalErrors(report *operationreport.Report, requestLogger *zap.Logger) {
	var internalErr error
	for _, err := range report.InternalErrors {
		internalErr = multierror.Append(internalErr, err)
	}

	if internalErr != nil {
		requestLogger.Error("internal error", zap.Error(internalErr))
	}
}

func (h *GraphQLHandler) writeRequestErrorsFromReport(report *operationreport.Report, w http.ResponseWriter, requestLogger *zap.Logger) {
	requestErrors := graphql.RequestErrorsFromOperationReport(*report)
	h.writeRequestErrors(requestErrors, w, requestLogger)

	// log internal errors
	h.logInternalErrors(report, requestLogger)

	// write internal server error if there are no external errors but there are internal errors
	if len(report.ExternalErrors) == 0 && len(report.InternalErrors) > 0 {
		h.writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
	}
}

func (h *GraphQLHandler) writeRequestErrors(requestErrors graphql.RequestErrors, w http.ResponseWriter, requestLogger *zap.Logger) {
	if requestErrors != nil {
		if _, err := requestErrors.WriteResponse(w); err != nil {
			requestLogger.Error("error writing response", zap.Error(err))
		}
	}
}

func (h *GraphQLHandler) respondWithInternalServerError(w http.ResponseWriter, requestLogger *zap.Logger) {
	w.WriteHeader(http.StatusInternalServerError)
	h.writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
}

func (h *GraphQLHandler) preparePlan(requestOperationName []byte, shared *pool.Shared) (planWithExtractedVariables, error) {
	// copy the extracted variables from the shared document
	// this is necessary because the shared document is reused across requests
	variables := make([]byte, len(shared.Doc.Input.Variables))
	copy(variables, shared.Doc.Input.Variables)

	// print the shared document into a buffer and reparse it
	// this is necessary because the shared document will be re-used across requests
	// as the plan is cached, and will have references to the document, it cannot be re-used
	buf := &bytes.Buffer{}
	err := shared.Printer.Print(shared.Doc, h.definition, buf)
	if err != nil {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}

	// parse the document again into a non-shared document, which will be used for planning
	// this will be cached, so it's insignificant that reparsing causes overhead
	doc, report := astparser.ParseGraphqlDocumentBytes(buf.Bytes())
	if report.HasErrors() {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}

	// validate the document before planning
	state := shared.Validation.Validate(&doc, h.definition, shared.Report)
	if state != astvalidation.Valid {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationValidationFailed, state.String())
	}

	// create and postprocess the plan
	preparedPlan := shared.Planner.Plan(&doc, h.definition, unsafebytes.BytesToString(requestOperationName), shared.Report)
	if shared.Report.HasErrors() {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}
	shared.Postprocess.Process(preparedPlan)

	return planWithExtractedVariables{
		preparedPlan: preparedPlan,
		variables:    variables,
	}, nil
}
