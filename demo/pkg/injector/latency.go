package injector

import (
	"log"
	"net/http"
	"strconv"
	"time"
)

// ArtificialLatencyHeader lets the playground or any client inject fake latency
// into a demo subgraph response. Value is milliseconds as an integer, bounded
// at 10000. Intended for demos where local subgraphs are too fast to make
// caching benefits visible.
const ArtificialLatencyHeader = "X-Artificial-Latency"

// Latency wraps a handler and sleeps for the number of milliseconds specified
// in the X-Artificial-Latency request header before passing the request down.
// Invalid values are silently ignored.
func Latency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v := r.Header.Get(ArtificialLatencyHeader); v != "" {
			if ms, err := strconv.Atoi(v); err == nil && ms > 0 && ms <= 10000 {
				log.Printf("[latency] %s %s sleep %dms prefix=%q", r.Method, r.Host, ms, r.Header.Get("X-WG-Cache-Key-Prefix"))
				time.Sleep(time.Duration(ms) * time.Millisecond)
			}
		}
		next.ServeHTTP(w, r)
	})
}
