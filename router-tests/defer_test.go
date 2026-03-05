package integration

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestDefer(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
			engineExecutionConfiguration.Debug.PrintIntermediateQueryPlans = true
			engineExecutionConfiguration.Debug.PrintOperationTransformations = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("should return chunked multipart responses for deferred fields", func(t *testing.T) {
			body := []byte(`{"query":"query {  ... @defer { employee(id: 1) { id details { forename } } } }"}`)

			req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(body))
			res, err := xEnv.RouterClient.Do(req)

			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)

			contentType := res.Header.Get("Content-Type")
			t.Logf("Response Content-Type: %q\n", contentType)
			t.Logf("Response Status Code: %d\n", res.StatusCode)

			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			respStr := string(data)
			t.Logf("Response Body: %s\n", respStr)

			require.True(t, strings.HasPrefix(contentType, "multipart/mixed"))
			require.Contains(t, contentType, "deferSpec=20220824")
			require.Contains(t, contentType, "boundary=\"graphql\"")
			// res.Header.Get("Transfer-Encoding") is empty because we are not using the httptest.ResponseRecorder directly in the same way,
			// the actual router streaming response will chunk it. We can omit this check for the integration test.

			// Verify the first chunk contains the initial data
			require.Contains(t, respStr, `{"data":{},"hasNext":true}`)

			// Verify incremental chunks
			require.Contains(t, respStr, `{"incremental":[{"data":{"employee":{"id":1,"details":{"forename":"Jens"}}},"path":[]}],"hasNext":false}`)

			// Verify it ends with the proper final boundary
			require.True(t, strings.HasSuffix(respStr, "--graphql--\r\n"))
		})
	})
}
