package core

import (
	"context"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"net/http"
	"strings"
)

type GraphAPITokenClaims struct {
	OrganizationID   string `json:"organization_id"`
	FederatedGraphID string `json:"federated_graph_id"`
	jwt.RegisteredClaims
}

type claimsContextKey string

const claimsKey claimsContextKey = "claims"

func getClaims(ctx context.Context) (*GraphAPITokenClaims, error) {
	claims, ok := ctx.Value(claimsKey).(*GraphAPITokenClaims)
	if !ok {
		return nil, fmt.Errorf("could not get claims from context")
	}
	return claims, nil
}

func setClaims(ctx context.Context, claims *GraphAPITokenClaims) context.Context {
	return context.WithValue(ctx, claimsKey, claims)
}

func authenticate(jwtSecret []byte, logger *zap.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		parts := strings.Split(r.Header.Get("Authorization"), " ")
		if len(parts) != 2 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		token, err := jwt.ParseWithClaims(parts[1], &GraphAPITokenClaims{}, func(token *jwt.Token) (interface{}, error) {
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

		claims, ok := token.Claims.(*GraphAPITokenClaims)
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		r = r.WithContext(setClaims(r.Context(), claims))

		next.ServeHTTP(w, r)
	})
}
