package injector

import "net/http"

func HTTP(next http.Handler) http.Handler {
	return HTTPFunc(next.ServeHTTP)
}

func HTTPFunc(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(NewContextWithHeader(r.Context(), r.Header))
		next.ServeHTTP(w, r)
	}
}
