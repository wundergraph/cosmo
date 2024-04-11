package core

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"io"
	"net/http"

	"github.com/andybalholm/brotli"
)

func CompressResponse(res *http.Response, req *http.Request) *http.Response {
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil
	}
	var compressedBody bytes.Buffer
	switch req.Header.Get("Accept-Encoding") {

	case "gzip":
		res.Header.Set("Content-Encoding", "gzip")

		gzWritter, err := gzip.NewWriterLevel(&compressedBody, gzip.BestSpeed)
		if err != nil {
			return nil
		}

		_, err = gzWritter.Write(body)
		if err != nil {
			return nil
		}

		io.Copy(gzWritter, res.Body)

		gzWritter.Close()

		res.Body = io.NopCloser(&compressedBody)

	case "deflate":
		res.Header.Set("Content-Encoding", "deflate")

		flateWritter, err := flate.NewWriter(&compressedBody, flate.BestSpeed)
		if err != nil {
			return nil
		}

		_, err = flateWritter.Write(body)
		if err != nil {
			return nil
		}

		io.Copy(flateWritter, res.Body)

		flateWritter.Close()

		res.Body = io.NopCloser(&compressedBody)

	case "br":
		res.Header.Set("Content-Encoding", "br")

		brWritter := brotli.NewWriterLevel(&compressedBody, brotli.BestSpeed)

		_, err = brWritter.Write(body)
		if err != nil {
			return nil
		}

		io.Copy(brWritter, res.Body)

		brWritter.Close()

		res.Body = io.NopCloser(&compressedBody)

	default:
		res.Header.Set("Content-Encoding", "gzip")

		gzWritter, err := gzip.NewWriterLevel(&compressedBody, gzip.BestSpeed)
		if err != nil {
			return nil
		}

		_, err = gzWritter.Write(body)
		if err != nil {
			return nil
		}

		io.Copy(gzWritter, res.Body)

		gzWritter.Close()

		res.Body = io.NopCloser(&compressedBody)

	}
	return res
}
