package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
)

type MultipartParser struct {
	operationProcessor *OperationProcessor
	maxUploadFiles     int
	maxUploadFileSize  int
	files              []*httpclient.FileUpload
	fileHandlers       []*os.File
	form               *multipart.Form
}

func NewMultipartParser(operationProcessor *OperationProcessor, maxUploadFiles int, maxUploadFileSize int) *MultipartParser {
	return &MultipartParser{
		operationProcessor: operationProcessor,
		maxUploadFiles:     maxUploadFiles,
		maxUploadFileSize:  maxUploadFileSize,
	}
}

func (p *MultipartParser) RemoveAll() (err error) {
	for _, file := range p.fileHandlers {
		cErr := file.Close()
		if cErr != nil && !errors.Is(cErr, os.ErrClosed) {
			err = errors.Join(err, cErr)
		}
		rErr := os.Remove(file.Name())
		if rErr != nil && !errors.Is(rErr, os.ErrNotExist) {
			err = errors.Join(err, rErr)
		}
	}
	if p.form != nil {
		err = errors.Join(err, p.form.RemoveAll())
	}
	return err
}

func (p *MultipartParser) processInMemoryFile(filePart []*multipart.FileHeader, file multipart.File, variablePath string) error {
	tempFile, err := os.CreateTemp("", "cosmo-upload-*")
	if err != nil {
		return err
	}

	defer tempFile.Close()
	p.fileHandlers = append(p.fileHandlers, tempFile)
	_, err = io.Copy(tempFile, file)
	if err != nil {
		return err
	}
	p.files = append(p.files, httpclient.NewFileUpload(tempFile.Name(), filePart[0].Filename, variablePath))

	return err
}

func (p *MultipartParser) processFilePart(filePart []*multipart.FileHeader, uploadsPath string) error {
	file, err := filePart[0].Open()
	if err != nil {
		return err
	}
	defer file.Close()

	if filePart[0].Size > int64(p.maxUploadFileSize) {
		return &httpGraphqlError{
			message:    "file too large to upload",
			statusCode: http.StatusOK,
		}
	}

	// Check if the file was written to the disk
	if diskFile, ok := file.(*os.File); ok {
		p.fileHandlers = append(p.fileHandlers, diskFile)
		p.files = append(p.files, httpclient.NewFileUpload(diskFile.Name(), filePart[0].Filename, uploadsPath))
	} else {
		// The file is in memory. We write it manually to the disk.
		err = p.processInMemoryFile(filePart, file, uploadsPath)
	}

	return err
}

func (p *MultipartParser) Parse(r *http.Request, buf *bytes.Buffer) ([]byte, []*httpclient.FileUpload, error) {
	var body []byte

	contentType := r.Header.Get("Content-Type")
	d, params, err := mime.ParseMediaType(contentType)
	if err != nil || d != "multipart/form-data" {
		return body, p.files, err
	}

	boundary, ok := params["boundary"]
	if !ok {
		return body, p.files, errors.New("could not find request boundary")
	}

	reader := multipart.NewReader(r.Body, boundary)
	p.form, err = reader.ReadForm(0)
	if err != nil {
		return body, p.files, &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if len(p.form.File) > p.maxUploadFiles {
		return body, p.files, &httpGraphqlError{
			message:    fmt.Sprintf("too many files: %d, max allowed: %d", len(p.form.File), p.maxUploadFiles),
			statusCode: http.StatusOK,
		}
	}

	body, err = p.operationProcessor.ReadBody(strings.NewReader(strings.Join(p.form.Value["operations"], "")), buf)
	if err != nil {
		return body, p.files, err
	}

	var uploadsList []string
	rawUploadsMap, ok := p.form.Value["map"]
	if ok {
		uploadsList, err = p.parseUploadMap(rawUploadsMap[0])
		if err != nil {
			return body, p.files, err
		}
	}

	if len(uploadsList) != len(p.form.File) {
		return body, p.files, &httpGraphqlError{
			message:    "number of files does not match the number of entries in the upload map",
			statusCode: http.StatusOK,
		}
	}

	fileIndex := 0
	for _, filePart := range p.form.File {
		uploadPath := uploadsList[fileIndex]
		err = p.processFilePart(filePart, uploadPath)
		if err != nil {
			return body, p.files, err
		}
		fileIndex++
	}

	return body, p.files, err
}

func (p *MultipartParser) parseUploadMap(rawUploadsMap string) ([]string, error) {
	var uploadsMap map[string][]string
	if err := json.Unmarshal([]byte(rawUploadsMap), &uploadsMap); err != nil {
		return nil, &httpGraphqlError{
			message:    fmt.Sprintf("failed to parse uploads map: %s", err.Error()),
			statusCode: http.StatusOK,
		}
	}

	result := make([]string, 0, len(uploadsMap))
	for fileIndex, variableName := range uploadsMap {
		if len(variableName) == 0 {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("empty variable name for upload index %s", fileIndex),
				statusCode: http.StatusOK,
			}
		}

		if len(variableName) > 1 {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("multiple variable names for upload index %s", fileIndex),
				statusCode: http.StatusOK,
			}
		}

		result = append(result, variableName[0])
	}

	return result, nil
}
