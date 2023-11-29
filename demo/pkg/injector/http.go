package injector

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
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
		if len(body) > 0 {
			payload := map[string]interface{}{}
			if err := json.Unmarshal(body, &payload); err != nil {
				panic(err)
			}
			r = r.WithContext(NewContextWithInitPayload(r.Context(), payload))
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next.ServeHTTP(w, r)
	}
}
