package middleware

import (
	"compress/gzip"
	"net/http"

	"go.uber.org/zap"
)

func HandleCompression(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Header.Get("Content-Encoding") {
			case "gzip":
				gzr, err := gzip.NewReader(r.Body)
				if err != nil {
					logger.Error("failed to create gzip reader", zap.Error(err))
					http.Error(w, "invalid gzip payload", http.StatusUnprocessableEntity)
					return
				}

				defer func() {
					if err := gzr.Close(); err != nil {
						logger.Error("failed to close gzip reader", zap.Error(err))
					}
				}()

				r.Body = gzr

			case "":
			default:
				http.Error(w, "unsupported content encoding", http.StatusBadRequest)
				return
			}

			// Remove the content encoding header to prevent any further decompression
			r.Header.Del("Content-Encoding")

			next.ServeHTTP(w, r)
		})
	}
}
