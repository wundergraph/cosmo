package injector

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
)

// cacheControl is put on every subgraph response when it is set, and nothing is
// sent when it is not.
//
// The router's entity cache is opt-in per response: one carrying no
// Cache-Control header is never cached, however the router is configured. These
// subgraphs have no caching opinion of their own and should not acquire one just
// by existing, so this stays off unless SUBGRAPH_CACHE_CONTROL is set, which is
// how the demo is pointed at a router that is caching.
//
//	SUBGRAPH_CACHE_CONTROL="public, max-age=60" ./run_subgraphs.sh
var cacheControl = os.Getenv("SUBGRAPH_CACHE_CONTROL")

func HTTP(next http.Handler) http.Handler {
	return HTTPFunc(next.ServeHTTP)
}

func HTTPFunc(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Before the handler runs, because it is the one that writes the body
		// and a header set after that is a header nobody receives.
		if cacheControl != "" {
			w.Header().Set("Cache-Control", cacheControl)
		}

		r = r.WithContext(NewContextWithHeader(r.Context(), r.Header))
		body, err := io.ReadAll(r.Body)
		if err != nil {
			panic(err)
		}
		r.Body = io.NopCloser(bytes.NewReader(body))

		contentType := r.Header.Get("Content-Type")

		if len(body) > 0 {
			if strings.Contains(contentType, "multipart/form-data") {
				clone := r.Clone(r.Context())
				if err := clone.ParseMultipartForm(1 << 30); err != nil {
					panic(err)
				}
				payload := make(map[string]interface{})
				for key, values := range clone.MultipartForm.Value {
					if len(values) > 0 {
						payload[key] = values[0]
					}
				}
				r = r.WithContext(NewContextWithInitPayload(r.Context(), payload))
			} else {
				payload := map[string]interface{}{}
				if err := json.Unmarshal(body, &payload); err != nil {
					panic(err)
				}
				r = r.WithContext(NewContextWithInitPayload(r.Context(), payload))
			}
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next.ServeHTTP(w, r)
	}
}
