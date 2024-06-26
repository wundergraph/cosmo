package core

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
)

type MultipartParser struct {
	operationProcessor *OperationProcessor
	maxUploadFiles     int
	maxUploadFileSize  int
}

func NewMultipartParser(operationProcessor *OperationProcessor, maxUploadFiles int, maxUploadFileSize int) *MultipartParser {
	return &MultipartParser{
		operationProcessor: operationProcessor,
		maxUploadFiles:     maxUploadFiles,
		maxUploadFileSize:  maxUploadFileSize,
	}
}

func (p *MultipartParser) parse(r *http.Request, buf *bytes.Buffer) ([]byte, []httpclient.File, []*os.File, error) {
	var body []byte
	var files []httpclient.File
	var fileHandlers []*os.File

	contentType := r.Header.Get("Content-Type")
	d, params, err := mime.ParseMediaType(contentType)
	if err != nil || d != "multipart/form-data" {
		return body, files, fileHandlers, err
	}

	boundary, ok := params["boundary"]
	if !ok {
		return body, files, fileHandlers, errors.New("could not find request boundary")
	}

	reader := multipart.NewReader(r.Body, boundary)
	form, err := reader.ReadForm(0)
	if err != nil {
		return body, files, fileHandlers, &inputError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if len(form.File) > p.maxUploadFiles {
		return body, files, fileHandlers, &inputError{
			message:    fmt.Sprintf("too many files: %d, max allowed: %d", len(form.File), p.maxUploadFiles),
			statusCode: http.StatusOK,
		}
	}

	body, err = p.operationProcessor.ReadBody(buf, strings.NewReader(strings.Join(form.Value["operations"], "")))
	if err != nil {
		return body, files, fileHandlers, err
	}

	for _, filePart := range form.File {
		file, err := filePart[0].Open()
		if err != nil {
			return body, files, fileHandlers, err
		}

		if filePart[0].Size > int64(p.maxUploadFileSize) {
			return body, files, fileHandlers, &inputError{
				message:    "file too large to upload",
				statusCode: http.StatusOK,
			}
		}

		// Check if the file was written to the disk
		if diskFile, ok := file.(*os.File); ok {
			fileHandlers = append(fileHandlers, diskFile)
			files = append(files, httpclient.NewFile(diskFile.Name(), filePart[0].Filename))
		} else {
			// The file is in memory. We write it manually to the disk.
			tempFile, err := os.CreateTemp("", "cosmo-upload-")
			if err != nil {
				return body, files, fileHandlers, err
			}
			_, err = io.Copy(tempFile, file)
			if err != nil {
				return body, files, fileHandlers, err
			}
			fileHandlers = append(fileHandlers, tempFile)
			files = append(files, httpclient.NewFile(tempFile.Name(), filePart[0].Filename))
			tempFile.Close()
		}

		file.Close()
	}

	return body, files, fileHandlers, nil
}
