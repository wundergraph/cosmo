package injector

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func HTTP(next http.Handler) http.Handler {
	return HTTPFunc(next.ServeHTTP)
}

func HTTPFunc(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
