// lat-proxy injects a per-subgraph artificial latency in front of a single
// upstream that serves all subgraphs on distinct path prefixes (the hive
// gateways-benchmark subgraph container: /accounts /products /reviews
// /inventory). The delay is applied to the RESPONSE (after the upstream call
// returns), matching the semantics of netem egress delay on the subgraph
// container used by the uniform benchmark.
//
// Env:
//
//	UPSTREAM  upstream base URL, e.g. http://bench-sg:4200
//	DELAYS    per-path-prefix delays, e.g. "accounts=20,products=20,reviews=20,inventory=150"
//	LISTEN    listen address (default :8080)
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	upstream := os.Getenv("UPSTREAM")
	if upstream == "" {
		log.Fatal("UPSTREAM is required")
	}
	target, err := url.Parse(upstream)
	if err != nil {
		log.Fatalf("invalid UPSTREAM: %v", err)
	}

	delays := map[string]time.Duration{}
	for pair := range strings.SplitSeq(os.Getenv("DELAYS"), ",") {
		name, ms, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if !ok || name == "" {
			continue
		}
		n, err := strconv.Atoi(ms)
		if err != nil {
			log.Fatalf("invalid delay %q: %v", pair, err)
		}
		delays[name] = time.Duration(n) * time.Millisecond
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	// The benchmark fans out aggressively; default transports throttle at
	// 2 idle conns per host, which fabricates failures under load.
	proxy.Transport = &http.Transport{
		MaxIdleConns:        4096,
		MaxIdleConnsPerHost: 4096,
		IdleConnTimeout:     90 * time.Second,
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		seg := strings.TrimPrefix(resp.Request.URL.Path, "/")
		if i := strings.IndexByte(seg, '/'); i >= 0 {
			seg = seg[:i]
		}
		if d, ok := delays[seg]; ok && d > 0 {
			time.Sleep(d)
		}
		return nil
	}

	listen := os.Getenv("LISTEN")
	if listen == "" {
		listen = ":8080"
	}
	log.Printf("lat-proxy listening on %s -> %s, delays=%v", listen, upstream, delays)
	log.Fatal(http.ListenAndServe(listen, proxy))
}
