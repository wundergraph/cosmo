package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/cespare/xxhash/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/goccy/go-json"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"io"
	"net/http"
)

type BatchedOperationId struct{}

const defaultBufioReaderSize = 4096

const (
	ExtensionCodeBatchSizeExceeded             = "BATCH_LIMIT_EXCEEDED"
	ExtensionCodeBatchSubscriptionsUnsupported = "BATCHING_SUBSCRIPTION_UNSUPPORTED"
)

type HandlerOpts struct {
	MaxEntriesPerBatch  int
	MaxRoutines         int
	HandlerSent         http.Handler
	Tracer              trace.Tracer
	ClientHeader        config.ClientHeader
	BaseOtelAttributes  []attribute.KeyValue
	RouterConfigVersion string
	Digest              *xxhash.Digest
	OmitExtensions      bool
	Logger              *zap.Logger
}

func Handler(handlerOpts HandlerOpts) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		requestLogger := handlerOpts.Logger.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		err := processBatchedRequest(w, r, handlerOpts, requestLogger)
		if err != nil {
			processBatchError(w, r, err, requestLogger)
			return
		}
	}

	return http.HandlerFunc(fn)
}

func processBatchedRequest(w http.ResponseWriter, r *http.Request, handlerOpts HandlerOpts, requestLogger *zap.Logger) error {
	firstChar, bufReader, err := getFirstNonWhitespaceChar(r.Body, defaultBufioReaderSize)
	if err != nil {
		requestLogger.Error("failed to read request", zap.Error(err))
		return &httpGraphqlError{
			message:    "failed to read request",
			statusCode: http.StatusOK,
		}
	}

	// When the first non whitespace character is not
	// an array start assume it's a non batched request
	if firstChar == nil || *firstChar != '[' {
		// if firstChar is nil we have downstream handle it
		// which is the current behaviour
		r.Body = io.NopCloser(bufReader)
		handlerOpts.HandlerSent.ServeHTTP(w, r)
		return nil
	}

	bodyBytes, err := io.ReadAll(bufReader)
	if err != nil {
		requestLogger.Error("failed to read request body", zap.Error(err))
		return &httpGraphqlError{
			message:    "failed to read request body",
			statusCode: http.StatusOK,
		}
	}

	var batchOperations []json.RawMessage
	if err = json.Unmarshal(bodyBytes, &batchOperations); err != nil {
		// If there is an error, it's likely a malformed json array
		// as the start character is "["
		requestLogger.Error("failed to read request body", zap.Error(err))
		return &httpGraphqlError{
			message:    "failed to read request body",
			statusCode: http.StatusOK,
		}
	}

	batchOperationsLength := len(batchOperations)

	ctrace.AddBatchTracing(r,
		bodyBytes,
		handlerOpts.ClientHeader,
		batchOperationsLength,
		handlerOpts.BaseOtelAttributes,
		handlerOpts.RouterConfigVersion,
		handlerOpts.Digest,
	)

	// When a max batch limit has been specified
	if batchOperationsLength > handlerOpts.MaxEntriesPerBatch {
		requestLogger.Error("max batch size has been exceeded")
		maxError := &httpGraphqlError{
			message:    "Invalid GraphQL request",
			statusCode: http.StatusOK,
		}
		if !handlerOpts.OmitExtensions {
			maxError.extensionCode = ExtensionCodeBatchSizeExceeded
		}
		return maxError
	}

	// We have a batched request.
	responses := make([]json.RawMessage, batchOperationsLength)

	sem := make(chan struct{}, handlerOpts.MaxRoutines)
	// Process each operation in parallel.
	for i, singleOp := range batchOperations {
		sem <- struct{}{}
		go func() {
			defer func() {
				<-sem
			}()

			batchOperationStr := fmt.Sprintf("batch-operation-%d", i)

			spanCtx, span := handlerOpts.Tracer.Start(r.Context(), batchOperationStr)
			ctx := context.WithValue(spanCtx, BatchedOperationId{}, batchOperationStr)

			defer span.End()

			// Create a new request for the single operation.
			rCopy := r.Clone(ctx)
			// Reset the route context to avoid sharing mutable state.
			rCopy = rCopy.WithContext(context.WithValue(rCopy.Context(), chi.RouteCtxKey, chi.NewRouteContext()))
			rCopy.Body = io.NopCloser(bytes.NewBuffer(singleOp))

			// Create a ResponseWriter that captures the output.
			rw := newBufferingResponseWriter()
			// Execute the mux handler for this operation.
			handlerOpts.HandlerSent.ServeHTTP(rw, rCopy)

			// Store the response (assuming the response is valid JSON).
			responses[i] = rw.Body.Bytes()
		}()
	}

	// Wait for all operations to be completed by blocking.
	for n := handlerOpts.MaxRoutines; n > 0; n-- {
		sem <- struct{}{}
	}

	// Drain and close the semaphore.
	for len(sem) > 0 {
		<-sem
	}
	close(sem)

	// Write out the batched response as a JSON array.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(responses); err != nil {
		return &httpGraphqlError{
			message:    "failed to encode batched response",
			statusCode: http.StatusInternalServerError,
		}
	}

	return nil
}

func processBatchError(w http.ResponseWriter, r *http.Request, err error, requestLogger *zap.Logger) {
	ctrace.AttachErrToSpanFromContext(r.Context(), err)

	requestError := graphqlerrors.RequestError{
		Message: err.Error(),
	}

	statusCode := http.StatusOK
	var httpGqlError *httpGraphqlError
	if errors.As(err, &httpGqlError) {
		statusCode = httpGqlError.statusCode
		if httpGqlError.extensionCode != "" {
			requestError.Extensions = &graphqlerrors.Extensions{
				Code: httpGqlError.extensionCode,
			}
		}
	}

	writeRequestErrors(r, w, statusCode, []graphqlerrors.RequestError{requestError}, requestLogger)
}

func getFirstNonWhitespaceChar(r io.Reader, readerSize int) (*byte, *bufio.Reader, error) {
	bufReader := bufio.NewReaderSize(r, readerSize)

	for {
		peeked, err := bufReader.Peek(1)
		if err != nil {
			if err == io.EOF {
				return nil, bufReader, nil
			}
			return nil, nil, err
		}

		if len(peeked) == 0 {
			return nil, bufReader, nil
		}
		peekByte := peeked[0]
		switch peekByte {
		// we check the characters based on this RFC https://datatracker.ietf.org/doc/html/rfc8259
		// and also the array decode function in goccy/go-json (which is the library we used to decode)
		case ' ', '\n', '\t', '\r':
			bufReader.ReadByte()
			continue
		default:
			return &peekByte, bufReader, nil
		}
	}
}

type bufferingResponseWriter struct {
	HeaderMap http.Header
	Body      *bytes.Buffer
	Status    int
}

func newBufferingResponseWriter() *bufferingResponseWriter {
	return &bufferingResponseWriter{
		HeaderMap: make(http.Header),
		Body:      &bytes.Buffer{},
		Status:    http.StatusOK,
	}
}

func (brw *bufferingResponseWriter) Header() http.Header {
	return brw.HeaderMap
}

func (brw *bufferingResponseWriter) Write(b []byte) (int, error) {
	return brw.Body.Write(b)
}

func (brw *bufferingResponseWriter) WriteHeader(statusCode int) {
	brw.Status = statusCode
}
