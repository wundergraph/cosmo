// MCP Debug Proxy is a tiny logging reverse proxy for eyeballing traffic
// between an MCP client (Claude Desktop, Cursor, ...) and the router's MCP
// endpoint during local development.
//
//	go run ./router-tests/cmd/mcp-debug-proxy -listen :5026 -target http://127.0.0.1:5025
//
// Point the client at http://localhost:<listen>/mcp.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func main() {
	listen := flag.String("listen", ":5026", "address to listen on")
	target := flag.String("target", "http://127.0.0.1:5025", "upstream MCP server URL")
	maxBody := flag.Int("max-body", 4096, "truncate logged bodies to N bytes")
	flag.Parse()

	upstream, err := url.Parse(*target)
	if err != nil {
		log.Fatalf("invalid -target: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ModifyResponse = func(resp *http.Response) error {
		logResponse(resp, *maxBody)
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error: %v", err)
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logRequest(r, *maxBody)
		proxy.ServeHTTP(w, r)
	})

	log.Printf("listening on %s, forwarding to %s", *listen, upstream)
	if err := http.ListenAndServe(*listen, handler); err != nil {
		log.Fatal(err)
	}
}

func logRequest(r *http.Request, maxBody int) {
	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))

	log.Printf("▶ %s %s", r.Method, r.URL.RequestURI())
	logHeaders("  →", r.Header)
	if len(body) > 0 {
		log.Printf("  → body: %s", formatBody(body, maxBody))
	}
}

func logResponse(resp *http.Response, maxBody int) {
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(body))

	log.Printf("◀ %d %s", resp.StatusCode, http.StatusText(resp.StatusCode))
	logHeaders("  ←", resp.Header)
	if len(body) > 0 {
		log.Printf("  ← body: %s", formatBody(body, maxBody))
	}
}

func logHeaders(prefix string, h http.Header) {
	for k, vs := range h {
		for _, v := range vs {
			log.Printf("%s %s: %s", prefix, k, v)
		}
	}
}

func formatBody(b []byte, maxLen int) string {
	out := b
	var pretty bytes.Buffer
	if json.Indent(&pretty, b, "", "  ") == nil {
		out = pretty.Bytes()
	}
	if len(out) > maxLen {
		return string(out[:maxLen]) + "…"
	}
	return string(out)
}
