package core

import (
	"compress/flate"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	br "github.com/andybalholm/brotli"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func TestCompression(t *testing.T) {
	httpRouter := chi.NewRouter()

	// Adds Brotli compressor
	brCompressor := middleware.NewCompressor(5, CustomCompressibleContentTypes...)
	brCompressor.SetEncoder("br", func(w io.Writer, level int) io.Writer {
		return br.NewWriterLevel(w, level)
	})
	httpRouter.Use(brCompressor.Handler)

	// Adds deflate & gzip compressor
	httpRouter.Use(middleware.AllowContentEncoding("deflate", "gzip"))

	httpRouter.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Content-Type", "text/plain")
		w.Write([]byte("Hello World !"))
	})

	// Create a test server
	ts := httptest.NewServer(httpRouter)
	defer ts.Close()

	// Test gzip compression
	testCompression(t, ts.URL, "gzip")

	// Test brotli compression
	testCompression(t, ts.URL, "br")

	// Test deflate compression
	testCompression(t, ts.URL, "deflate")
}

func testCompression(t *testing.T, url, encoding string) {
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

	if string(body) != "Hello World !" {
		t.Errorf("expected response body 'Hello World !', got '%s'", string(body))
	}
}
