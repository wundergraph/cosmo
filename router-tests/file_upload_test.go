package integration

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
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

func TestSingleFileUploadWithCompression(t *testing.T) {
	t.Parallel()

	t.Run("Uploading file without compressed body should return 422", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes:  5 << 20,
					DecompressionEnabled: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			fileContent := bytes.Repeat([]byte("a"), 1024)
			files := [][]byte{fileContent}

			header := http.Header{
				"Content-Encoding": []string{"gzip"},
			}

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
				Variables: []byte(`{"file":null}`),
				Files:     files,
				Header:    header,
			})

			require.NoError(t, err)
			require.Equal(t, http.StatusUnprocessableEntity, res.Response.StatusCode)
		})
	})

	t.Run("Uploading file with compressed body should return 200", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes:  5 << 20,
					DecompressionEnabled: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			fileContent := bytes.Repeat([]byte("a"), 1024)
			files := [][]byte{fileContent}

			gqlReq := testenv.GraphQLRequest{
				Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
				Variables: []byte(`{"file":null}`),
				Files:     files,
			}

			data, err := json.Marshal(gqlReq)
			require.NoError(t, err)

			var b bytes.Buffer
			w := multipart.NewWriter(&b)

			// create file part
			filePart, err := w.CreateFormFile("variables.file", uuid.NewString())
			require.NoError(t, err)
			_, err = io.Copy(filePart, bytes.NewReader(gqlReq.Files[0]))
			require.NoError(t, err)

			// create operations part
			operationsPart, err := w.CreateFormField("operations")
			require.NoError(t, err)
			_, err = io.Copy(operationsPart, bytes.NewReader(data))
			require.NoError(t, err)

			// create map part
			mapPart, err := w.CreateFormField("map")
			require.NoError(t, err)
			_, err = io.Copy(mapPart, strings.NewReader(`{ "0": ["variables.file"] }`))
			require.NoError(t, err)
			require.NoError(t, w.Close())

			var sb strings.Builder
			gw := gzip.NewWriter(&sb)

			_, err = gw.Write(b.Bytes())
			require.NoError(t, err)

			require.NoError(t, gw.Close())

			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(), strings.NewReader(sb.String()))
			require.NoError(t, err)

			req.Header.Set("Content-Type", w.FormDataContentType())
			req.Header.Set("Content-Encoding", "gzip")

			resp, err := xEnv.RouterClient.Do(req)
			require.NoError(t, err)

			defer resp.Body.Close()
			buf := new(bytes.Buffer)
			_, err = buf.ReadFrom(resp.Body)
			require.NoError(t, err)

			require.JSONEq(t, `{"data":{"singleUpload": true}}`, buf.String())
		})
	})

}

func TestSingleFileUpload_InvalidFileFormat(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":"invalid_format"}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"string is not an Upload","path":["singleUpload","file"]}],"statusCode":200}}],"data":null}`, res.Body)
	})
}

func TestSingleFileUpload_NoFileProvided(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation ($file: Upload!){singleUpload(file: $file)}",
			Variables: []byte(`{"file":null}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"cannot be null","path":["variable","file"],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}],"statusCode":422}}],"data":null}`, res.Body)
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
		require.Equal(t, `{"errors":[{"message":"file too large to upload"}]}`, res.Body)
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
		require.Equal(t, `{"errors":[{"message":"too many files: 3, max allowed: 2"}]}`, res.Body)
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
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"string is not an Upload","path":["multipleUpload","files",0]}],"statusCode":200}}],"data":null}`, res.Body)
	})
}

func TestMultipleFilesUpload_NoFilesProvided(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
			Variables: []byte(`{"files":null}`),
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"cannot be null","path":["variable","files"],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}],"statusCode":422}}],"data":null}`, res.Body)
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
		require.Equal(t, `{"errors":[{"message":"file upload disabled"}]}`, res.Body)
	})
}
