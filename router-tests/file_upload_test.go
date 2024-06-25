package integration_test

import (
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestSingleFileUpload(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{"data":{"singleUpload": true}}`))
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 1)
		files[0] = []byte("File content as text")
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":null}`),
			Files:     files,
		})
		require.JSONEq(t, `{"data":{"singleUpload": true}}`, res.Body)
	})
}

func TestMultipleFilesUpload(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{"data":{"multipleUpload": true}}`))
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 2)
		files[0] = []byte("File1 content as text")
		files[1] = []byte("File2 content as text")
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file1: Upload!, $file2: Upload!){multipleUpload(files: [$file1, $file2])}",
			Variables: []byte(`{"file1":null, "file2":null}`),
			Files:     files,
		})
		require.JSONEq(t, `{"data":{"multipleUpload": true}}`, res.Body)
	})
}
