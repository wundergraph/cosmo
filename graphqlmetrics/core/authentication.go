package core

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

func authenticate(jwtSecret []byte, logger *zap.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		parts := strings.Split(r.Header.Get("Authorization"), " ")
		if len(parts) != 2 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		token, err := jwt.ParseWithClaims(parts[1], &utils.GraphAPITokenClaims{}, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return jwtSecret, nil
		})
		if err != nil {
			logger.Debug("Failed to parse token", zap.Error(err))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if !token.Valid {
			logger.Debug("Token is invalid", zap.Bool("valid", token.Valid))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(*utils.GraphAPITokenClaims)
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		r = r.WithContext(utils.SetClaims(r.Context(), claims))

		next.ServeHTTP(w, r)
	})
}
