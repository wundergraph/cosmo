package core

import (
	"compress/flate"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	br "github.com/andybalholm/brotli"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

var responses = map[string]string{
	"text/html":                "<html><body>Hello World !</body></html>",
	"text/css":                 "body { color: black; }",
	"text/plain":               "Hello World !",
	"text/javascript":          "console.log('Hello World !');",
	"application/javascript":   "console.log('Hello World !');",
	"application/x-javascript": "console.log('Hello World !');",
	"application/json":         `{"message": "Hello World !"}`,
	"application/atom+xml":     `<feed><title>Hello World !</title></feed>`,
	"application/rss+xml":      `<rss><channel><title>Hello World !</title></channel></rss>`,
	"image/svg+xml":            `<svg><text>Hello World !</text></svg>`,
	"application/graphql":      `query { message }`,
}

func TestCompression(t *testing.T) {
	httpRouter := chi.NewRouter()

	// Add a route for each content type
	for _, contentType := range CustomCompressibleContentTypes {
		httpRouter.Get("/"+contentType, func(contentType string) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				w.Header().Add("Content-Type", contentType)
				w.Write([]byte(responses[contentType]))
			}
		}(contentType))
	}

	// Create a test server without compression
	ts := httptest.NewServer(httpRouter)
	defer ts.Close()

	// Test each content type without compression
	for _, contentType := range CustomCompressibleContentTypes {
		t.Run("uncompressed-"+contentType, func(t *testing.T) {
			testUncompressedResponse(t, ts.URL+"/"+contentType, contentType)
		})
	}

	// Now add compression middleware
	compressedRouter := chi.NewRouter()

	// Adds Brotli compressor
	brCompressor := middleware.NewCompressor(5, CustomCompressibleContentTypes...)
	brCompressor.SetEncoder("br", func(w io.Writer, level int) io.Writer {
		return br.NewWriterLevel(w, level)
	})
	compressedRouter.Use(middleware.AllowContentEncoding("deflate", "gzip"))
	compressedRouter.Use(brCompressor.Handler)

	// Add the same routes to the compressed router
	for _, contentType := range CustomCompressibleContentTypes {
		compressedRouter.Get("/"+contentType, func(contentType string) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				w.Header().Add("Content-Type", contentType)
				w.Write([]byte(responses[contentType]))
			}
		}(contentType))
	}

	// Recreate the test server with compression
	tsCompressed := httptest.NewServer(compressedRouter)
	defer tsCompressed.Close()

	// Test each content type with each encoding
	for _, contentType := range CustomCompressibleContentTypes {
		t.Run("gzip-"+contentType, func(t *testing.T) {
			testCompression(t, tsCompressed.URL+"/"+contentType, contentType, "gzip")
		})
		t.Run("br-"+contentType, func(t *testing.T) {
			testCompression(t, tsCompressed.URL+"/"+contentType, contentType, "br")
		})
		t.Run("deflate-"+contentType, func(t *testing.T) {
			testCompression(t, tsCompressed.URL+"/"+contentType, contentType, "deflate")
		})
	}
}

func testUncompressedResponse(t *testing.T, url, contentType string) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("error creating request: %v", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("error making request: %v", err)
	}
	defer resp.Body.Close()

	if resp.Header.Get("Content-Type") != contentType {
		t.Errorf("expected %s content type, got %s", contentType, resp.Header.Get("Content-Type"))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("error reading response body: %v", err)
	}

	expectedResponse := responses[contentType]
	if contentType == "application/json" {
		var expected map[string]string
		var actual map[string]string

		if err := json.Unmarshal([]byte(expectedResponse), &expected); err != nil {
			t.Fatalf("error unmarshaling expected response: %v", err)
		}
		if err := json.Unmarshal(body, &actual); err != nil {
			t.Fatalf("error unmarshaling actual response: %v", err)
		}
		if expected["message"] != actual["message"] {
			t.Errorf("expected response body %v, got %v", expected, actual)
		}
	} else {
		if string(body) != expectedResponse {
			t.Errorf("expected response body '%s', got '%s'", expectedResponse, string(body))
		}
	}
}

func testCompression(t *testing.T, url, contentType, encoding string) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("error creating request: %v", err)
	}
	req.Header.Set("Accept-Encoding", encoding)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("error making request: %v", err)
	}
	defer resp.Body.Close()

	if resp.Header.Get("Content-Encoding") != encoding {
		t.Errorf("expected %s content encoding", encoding)
	}

	if resp.Header.Get("Content-Type") != contentType {
		t.Errorf("expected %s content type, got %s", contentType, resp.Header.Get("Content-Type"))
	}

	// Verify decompression based on the encoding
	var body []byte
	switch encoding {
	case "gzip":
		gr, err := gzip.NewReader(resp.Body)
		if err != nil {
			t.Fatalf("error creating gzip reader: %v", err)
		}
		defer gr.Close()

		body, err = io.ReadAll(gr)
		if err != nil {
			t.Fatalf("error reading response body: %v", err)
		}
	case "br":
		brw := br.NewReader(resp.Body)

		body, err = io.ReadAll(brw)
		if err != nil {
			t.Fatalf("error reading response body: %v", err)
		}
	case "deflate":
		fr := flate.NewReader(resp.Body)
		defer fr.Close()

		body, err = io.ReadAll(fr)
		if err != nil {
			t.Fatalf("error reading response body: %v", err)
		}
	}

	expectedResponse := responses[contentType]
	if contentType == "application/json" {
		var expected map[string]string
		var actual map[string]string

		if err := json.Unmarshal([]byte(expectedResponse), &expected); err != nil {
			t.Fatalf("error unmarshaling expected response: %v", err)
		}
		if err := json.Unmarshal(body, &actual); err != nil {
			t.Fatalf("error unmarshaling actual response: %v", err)
		}
		if expected["message"] != actual["message"] {
			t.Errorf("expected response body %v, got %v", expected, actual)
		}
	} else {
		if string(body) != expectedResponse {
			t.Errorf("expected response body '%s', got '%s'", expectedResponse, string(body))
		}
	}
}
