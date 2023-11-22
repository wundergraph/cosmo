package core

import (
	"errors"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNoError(t *testing.T) {

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", nil)

	requestContext := &requestContext{
		logger:         zap.NewNop(),
		keys:           map[string]any{},
		responseWriter: rr,
		request:        req,
		operation:      nil,
		subgraphs:      nil,
	}

	WriteResponseError(requestContext, nil)

	body, err := io.ReadAll(rr.Result().Body)
	require.NoError(t, err)

	require.Equal(t, `{"errors":[{"message":"Internal Error"}],"data":null}`, string(body))
}

func TestSingleError(t *testing.T) {

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", nil)

	requestContext := &requestContext{
		logger:         zap.NewNop(),
		keys:           map[string]any{},
		responseWriter: rr,
		request:        req,
		operation:      nil,
		subgraphs:      nil,
	}

	WriteResponseError(requestContext, errors.New("test"))

	body, err := io.ReadAll(rr.Result().Body)
	require.NoError(t, err)

	require.Equal(t, `{"errors":[{"message":"test"}],"data":null}`, string(body))
}
