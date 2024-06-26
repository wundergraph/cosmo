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

func (p *MultipartParser) RemoveAll() {
	for _, file := range p.fileHandlers {
		file.Close()
		os.Remove(file.Name())
	}
	if p.form != nil {
		p.form.RemoveAll()
	}
}

func (p *MultipartParser) processInMemoryFile(filePart []*multipart.FileHeader, file multipart.File, body []byte, files []httpclient.File) ([]byte, []httpclient.File, error) {
	// The file is in memory. We write it manually to the disk.
	tempFile, err := os.CreateTemp("", "cosmo-upload-")
	if err != nil {
		return body, files, err
	}

	defer tempFile.Close()
	p.fileHandlers = append(p.fileHandlers, tempFile)
	_, err = io.Copy(tempFile, file)
	if err != nil {
		return body, files, err
	}
	files = append(files, httpclient.NewFile(tempFile.Name(), filePart[0].Filename))

	return body, files, err
}

func (p *MultipartParser) processFilePart(filePart []*multipart.FileHeader, body []byte, files []httpclient.File) ([]byte, []httpclient.File, error) {
	file, err := filePart[0].Open()
	if err != nil {
		return body, files, err
	}
	defer file.Close()

	if filePart[0].Size > int64(p.maxUploadFileSize) {
		return body, files, &inputError{
			message:    "file too large to upload",
			statusCode: http.StatusOK,
		}
	}

	// Check if the file was written to the disk
	if diskFile, ok := file.(*os.File); ok {
		p.fileHandlers = append(p.fileHandlers, diskFile)
		files = append(files, httpclient.NewFile(diskFile.Name(), filePart[0].Filename))
	} else {
		// The file is in memory. We write it manually to the disk.
		body, files, err = p.processInMemoryFile(filePart, file, body, files)
	}

	return body, files, err
}

func (p *MultipartParser) Parse(r *http.Request, buf *bytes.Buffer) ([]byte, []httpclient.File, error) {
	var body []byte
	var files []httpclient.File
	contentType := r.Header.Get("Content-Type")
	d, params, err := mime.ParseMediaType(contentType)
	if err != nil || d != "multipart/form-data" {
		return body, files, err
	}

	boundary, ok := params["boundary"]
	if !ok {
		return body, files, errors.New("could not find request boundary")
	}

	reader := multipart.NewReader(r.Body, boundary)
	p.form, err = reader.ReadForm(0)
	if err != nil {
		return body, files, &inputError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if len(p.form.File) > p.maxUploadFiles {
		return body, files, &inputError{
			message:    fmt.Sprintf("too many files: %d, max allowed: %d", len(p.form.File), p.maxUploadFiles),
			statusCode: http.StatusOK,
		}
	}

	body, err = p.operationProcessor.ReadBody(buf, strings.NewReader(strings.Join(p.form.Value["operations"], "")))
	if err != nil {
		return body, files, err
	}

	for _, filePart := range p.form.File {
		body, files, err = p.processFilePart(filePart, body, files)
		if err != nil {
			return body, files, err
		}
	}

	return body, files, err
}
