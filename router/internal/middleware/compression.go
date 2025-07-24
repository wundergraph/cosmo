package middleware

import (
	"compress/gzip"

	"net/http"
	"strings"

	"go.uber.org/zap"
)

func HandleCompression(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// compression handling is only relevant for POST requests with a body
			if r.Method != http.MethodPost || r.ContentLength == 0 {
				next.ServeHTTP(w, r)
				return
			}

			encodings := strings.Split(r.Header.Get("Content-Encoding"), ",")
			if len(encodings) > 1 {
				http.Error(w, "multiple chained compressions not supported yet", http.StatusBadRequest)
				return
			}

			switch strings.TrimSpace(encodings[0]) {
			case "gzip":
				gzr, err := gzip.NewReader(r.Body)
				if err != nil {
					logger.Error("failed to create gzip reader", zap.Error(err))
					http.Error(w, "invalid gzip payload", http.StatusUnprocessableEntity)
					return
				}

				originalBody := r.Body

				defer func() {
					if err := gzr.Close(); err != nil {
						logger.Error("failed to close gzip reader", zap.Error(err))
					}

					if err := originalBody.Close(); err != nil {
						logger.Error("failed to close original body", zap.Error(err))
					}
				}()

				r.Body = gzr

				// Content-Length is no longer valid after decompression
				r.Header.Del("Content-Length")
				r.ContentLength = -1
			case "":
			default:
				http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
				return
			}

			// Remove the content encoding header to prevent any further decompression
			r.Header.Del("Content-Encoding")

			next.ServeHTTP(w, r)
		})
	}
}
