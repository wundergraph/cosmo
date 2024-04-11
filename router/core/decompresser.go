package core

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"io"
	"net/http"

	"github.com/andybalholm/brotli"
)

func DecompressResponse(req *http.Request) *http.Request {

	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil
	}
	var decompressedBody io.Reader

	switch req.Header.Get("Content-Encoding") {

	case "gzip":

		gzReader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil
		}

		decompressedBody = gzReader

	case "deflate":

		flateReader := flate.NewReader(bytes.NewReader(body))

		decompressedBody = flateReader

	case "br":

		brReader := brotli.NewReader(bytes.NewReader(body))

		decompressedBody = brReader

	default:
		gzReader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil
		}

		decompressedBody = gzReader

	}
	req.Body = io.NopCloser(decompressedBody)

	return req
}
