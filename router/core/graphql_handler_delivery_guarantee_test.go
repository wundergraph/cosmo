package core

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// fakeSubscriptionWriter records which delivery path writeError takes.
type fakeSubscriptionWriter struct {
	bytes.Buffer
	errorData []byte
	flushed   bool
}

func (f *fakeSubscriptionWriter) Flush() error     { f.flushed = true; return nil }
func (f *fakeSubscriptionWriter) Complete()        {}
func (f *fakeSubscriptionWriter) Heartbeat() error { return nil }
func (f *fakeSubscriptionWriter) Error(data []byte) {
	f.errorData = append([]byte(nil), data...)
}

func newDeliveryGuaranteeTestContext() *resolve.Context {
	logger := zap.NewNop()
	reqCtx := &requestContext{logger: logger}
	return resolve.NewContext(withRequestContext(context.Background(), reqCtx))
}

func TestGraphQLHandlerWriteError_DeliveryGuarantee(t *testing.T) {
	h := &GraphQLHandler{log: zap.NewNop()}
	err := fmt.Errorf("wrapped: %w", &datasource.DeliveryGuaranteeError{
		Code:      datasource.DeliveryGuaranteeErrorCodeUnsupported,
		Supported: []datasource.DeliveryGuarantee{datasource.DeliveryGuaranteeAtMostOnce},
		Message:   "not supported",
	})

	require.True(t, isTerminalSubscriptionError(err))

	t.Run("subscription writer takes the terminal path", func(t *testing.T) {
		w := &fakeSubscriptionWriter{}
		h.WriteError(newDeliveryGuaranteeTestContext(), err, nil, w)

		require.NotEmpty(t, w.errorData)
		assert.Empty(t, w.Bytes())
		assert.JSONEq(t,
			`{"errors":[{"message":"not supported","extensions":{"code":"DELIVERY_GUARANTEE_UNSUPPORTED","cosmoCursor":{"supported":["at-most-once"]}}}],"data":null}`,
			string(w.errorData))
	})

	t.Run("http writer responds with 200", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.WriteError(newDeliveryGuaranteeTestContext(), err, nil, rec)
		assert.Equal(t, 200, rec.Code)
		assert.Contains(t, rec.Body.String(), "DELIVERY_GUARANTEE_UNSUPPORTED")
	})

	t.Run("other errors are not delivery guarantee errors", func(t *testing.T) {
		assert.NotEqual(t, errorTypeDeliveryGuarantee, getErrorType(errors.New("x")))
	})
}
