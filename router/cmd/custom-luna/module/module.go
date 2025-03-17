package module

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/buger/jsonparser"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

func init() {
	core.RegisterModule(&FileUploadEmptyVarModule{})
}

const ModuleID = "com.getluna.file-upload-empty-var"

type FileUploadEmptyVarModule struct {
	Logger *zap.Logger
}

func (m *FileUploadEmptyVarModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	r := ctx.Request()
	w := ctx.ResponseWriter()

	mediatype, p, err := mime.ParseMediaType(r.Header.Get("Content-Type"))

	if err != nil {
		core.WriteResponseError(ctx, fmt.Errorf("Error parsing media type: %w", err))
		return
	}

	if mediatype != "multipart/form-data" {
		next.ServeHTTP(w, r)
		return
	}

	boundary, ok := p["boundary"]
	if !ok {
		core.WriteResponseError(ctx, fmt.Errorf("No boundary found in multipart form"))
		return
	}

	var body bytes.Buffer
	parsedMultipart := multipart.NewWriter(&body)

	reader := multipart.NewReader(r.Body, boundary)

	form, err := reader.ReadForm(0)

	if err != nil {
		core.WriteResponseError(ctx, fmt.Errorf("Error reading form from multipart: %w", err))
		return
	}

	operations, operationsExists := form.Value["operations"]
	maps, mapPartExists := form.Value["map"]

	var parsedOperations string

	if operationsExists && len(operations) > 0 && mapPartExists && len(maps) > 0 {
		jsonOperations := []byte(operations[0])
		jsonMap := []byte(maps[0])

		err = jsonparser.ObjectEach(jsonMap, func(_ []byte, paths []byte, dataType jsonparser.ValueType, _ int) error {
			fmt.Println("paths", string(paths))

			if dataType != jsonparser.Array {
				return nil
			}

			_, err = jsonparser.ArrayEach(paths, func(path []byte, dataType jsonparser.ValueType, offset int, err error) {
				fmt.Println("path", string(path))

				if err != nil {
					return
				}

				if dataType != jsonparser.String {
					return
				}

				pathElements := strings.Split(string(path), ".")


				jsonOperations, err = jsonparser.Set(jsonOperations, []byte("null"), pathElements...)
			})

			return err
		})

		if err != nil {
			core.WriteResponseError(ctx, fmt.Errorf("Error parsing map: %w", err))
			return
		}

		parsedOperations = string(jsonOperations)
	}

	for key, values := range form.Value {
		if key == "operations" && parsedOperations != "" {
			err = parsedMultipart.WriteField("operations", parsedOperations)
			if err != nil {
				core.WriteResponseError(ctx, fmt.Errorf("Error writing operations field: %w", err))
				return
			}
			continue
		}

		for _, value := range values {
			err = parsedMultipart.WriteField(key, value)
			if err != nil {
				core.WriteResponseError(ctx, fmt.Errorf("Error writing field %s: %w", key, err))
				return
			}
		}
	}

	for key, files := range form.File {
		for _, fileHeader := range files {
			fileWriter, err := parsedMultipart.CreateFormFile(key, fileHeader.Filename)
			if err != nil {
				core.WriteResponseError(ctx, fmt.Errorf("Error creating form file %s: %w", fileHeader.Filename, err))
				return
			}

			fileReader, err := fileHeader.Open()
			if err != nil {
				core.WriteResponseError(ctx, fmt.Errorf("Error opening file %s: %w", fileHeader.Filename, err))
				return
			}

			defer fileReader.Close()

			_, err = io.Copy(fileWriter, fileReader)

			if err != nil {
				core.WriteResponseError(ctx, fmt.Errorf("Error copying file %s: %w", fileHeader.Filename, err))
				return
			}
		}

	}

	parsedMultipart.Close()

	r.Header.Set("Content-Type", parsedMultipart.FormDataContentType())
	r.Body = io.NopCloser(&body)

	next.ServeHTTP(w, r)
}

func (m *FileUploadEmptyVarModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: ModuleID,
		New: func() core.Module {
			return &FileUploadEmptyVarModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterOnRequestHandler = (*FileUploadEmptyVarModule)(nil)
)
