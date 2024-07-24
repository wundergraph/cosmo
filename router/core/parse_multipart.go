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
	files              []httpclient.File
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
		err = errors.Join(err, file.Close())
		err = errors.Join(err, os.Remove(file.Name()))
	}
	if p.form != nil {
		err = errors.Join(err, p.form.RemoveAll())
	}
	return err
}

func (p *MultipartParser) processInMemoryFile(filePart []*multipart.FileHeader, file multipart.File) error {
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
	p.files = append(p.files, httpclient.NewFile(tempFile.Name(), filePart[0].Filename))

	return err
}

func (p *MultipartParser) processFilePart(filePart []*multipart.FileHeader) error {
	file, err := filePart[0].Open()
	if err != nil {
		return err
	}
	defer file.Close()

	if filePart[0].Size > int64(p.maxUploadFileSize) {
		return &inputError{
			message:    "file too large to upload",
			statusCode: http.StatusOK,
		}
	}

	// Check if the file was written to the disk
	if diskFile, ok := file.(*os.File); ok {
		p.fileHandlers = append(p.fileHandlers, diskFile)
		p.files = append(p.files, httpclient.NewFile(diskFile.Name(), filePart[0].Filename))
	} else {
		// The file is in memory. We write it manually to the disk.
		err = p.processInMemoryFile(filePart, file)
	}

	return err
}

func (p *MultipartParser) Parse(r *http.Request, buf *bytes.Buffer) ([]byte, []httpclient.File, error) {
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
		return body, p.files, &inputError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if len(p.form.File) > p.maxUploadFiles {
		return body, p.files, &inputError{
			message:    fmt.Sprintf("too many files: %d, max allowed: %d", len(p.form.File), p.maxUploadFiles),
			statusCode: http.StatusOK,
		}
	}

	body, err = p.operationProcessor.ReadBody(buf, strings.NewReader(strings.Join(p.form.Value["operations"], "")))
	if err != nil {
		return body, p.files, err
	}

	for _, filePart := range p.form.File {
		err = p.processFilePart(filePart)
		if err != nil {
			return body, p.files, err
		}
	}

	return body, p.files, err
}
