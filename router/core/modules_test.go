package core

import (
	"errors"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"io"
	"net/http/httptest"
	"testing"
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

	require.Equal(t, `{"errors":[]}`, string(body))
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

	require.Equal(t, `{"errors":[{"message":"test"}]}`, string(body))
}
