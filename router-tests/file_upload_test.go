package integration_test

import (
	"bytes"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestSingleFileUpload(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		fileContent := bytes.Repeat([]byte("a"), 1024)
		files := [][]byte{fileContent}
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":null}`),
			Files:     files,
		})
		require.JSONEq(t, `{"data":{"singleUpload": true}}`, res.Body)
	})
}

func TestSingleFileUpload_InvalidFileFormat(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":"invalid_format"}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0'.","extensions":{"errors":[{"message":"string is not an Upload","path":["singleUpload","file"]}],"statusCode":200}}],"data":null}`, res.Body)
	})
}

func TestSingleFileUpload_NoFileProvided(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":null}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0'.","extensions":{"errors":[{"message":"cannot be null","path":["variable","file"],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}],"statusCode":422}}],"data":null}`, res.Body)
	})
}

func TestFileUpload_FilesSizeExceedsLimit(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithFileUploadConfig(&config.FileUpload{
			Enabled:          true,
			MaxFiles:         1,
			MaxFileSizeBytes: 50,
		})},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 1)
		files[0] = []byte("This is an example of a large file that exceeds the max request body size.")
		res, err := xEnv.MakeGraphQLRequestAsMultipartForm(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":null}`),
			Files:     files,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)
		require.Equal(t, `{"errors":[{"message":"file too large to upload"}],"data":null}`, res.Body)
	})
}

func TestFileUpload_FilesExceedsLimit(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithFileUploadConfig(&config.FileUpload{
			Enabled:          true,
			MaxFiles:         2,
			MaxFileSizeBytes: 50000,
		})},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 3)
		files[0] = []byte("File1 content as text")
		files[1] = []byte("File2 content as text")
		files[2] = []byte("File3 content as text")
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":[null, null, null]}`),
			Files:     files,
		})
		require.Equal(t, `{"errors":[{"message":"too many files: 3, max allowed: 2"}],"data":null}`, res.Body)
	})
}

func TestMultipleFilesUpload(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 2)
		files[0] = []byte("Contents of first file")
		files[1] = []byte("Contents of second file")
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":[null, null]}`),
			Files:     files,
		})
		require.JSONEq(t, `{"data":{"multipleUpload": true}}`, res.Body)
	})
}

func TestMultipleFilesUpload_InvalidFileFormat(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":["invalid_format1", "invalid_format2"]}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0'.","extensions":{"errors":[{"message":"string is not an Upload","path":["multipleUpload","files",0]}],"statusCode":200}}],"data":null}`, res.Body)
	})
}

func TestMultipleFilesUpload_NoFilesProvided(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":null}`),
		})
		fmt.Println(res.Body)
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0'.","extensions":{"errors":[{"message":"cannot be null","path":["variable","files"],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}],"statusCode":422}}],"data":null}`, res.Body)
	})
}

func TestFileUpload_UploadDisabled(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithFileUploadConfig(&config.FileUpload{
			Enabled: false,
		})},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		files := make([][]byte, 1)
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":[null]}`),
			Files:     files,
		})
		require.Equal(t, `{"errors":[{"message":"file upload disabled"}],"data":null}`, res.Body)
	})
}
