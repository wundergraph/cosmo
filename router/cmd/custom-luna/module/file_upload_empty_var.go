package module

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

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

	operations, formHasOperations := form.Value["operations"]
	maps, mapPartExists := form.Value["map"]

	parsedOperations := operations[0]

	if formHasOperations && mapPartExists {

		var jsonOperations map[string]any
		var jsonMap map[string]any

		err = json.Unmarshal([]byte(operations[0]), &jsonOperations)
		if err != nil {
			core.WriteResponseError(ctx, fmt.Errorf("Error unmarshalling operations: %w", err))
			return
		}

		err = json.Unmarshal([]byte(maps[0]), &jsonMap)
		if err != nil {
			core.WriteResponseError(ctx, fmt.Errorf("Error unmarshalling map: %w", err))
			return
		}

		for _, paths := range jsonMap {
			for _, path := range paths.([]any) {
				setNullAtPath(jsonOperations, path.(string))
			}
		}

		parsedOperationsBytes, err := json.Marshal(jsonOperations)
		if err != nil {
			core.WriteResponseError(ctx, fmt.Errorf("Error marshalling operations: %w", err))
			return
		}

		parsedOperations = string(parsedOperationsBytes)
	}

	for key, values := range form.Value {
		if key == "operations" {
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

func setNullAtPath(data map[string]any, path string) {
	keys := strings.Split(path, ".")
	subMap := data

	for i, key := range keys {
		// If this is the last key in the path, set it to nil and return.
		if i == len(keys)-1 {
			subMap[key] = nil
			return
		}

		// If the next level doesn't exist or isn't a map, make a new one.
		if _, ok := subMap[key].(map[string]any); !ok {
			subMap[key] = make(map[string]any)
		}

		// Move deeper into the map for the next iteration.
		subMap = subMap[key].(map[string]any)
	}
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
