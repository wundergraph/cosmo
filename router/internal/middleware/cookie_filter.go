package middleware

import (
	"net/http"
	"slices"
)

func CookieWhitelist(cookieWhitelist []string, cookieSafelist []string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, rr *http.Request) {
			if len(cookieWhitelist) == 0 {
				next.ServeHTTP(rw, rr)
				return
			}

			cookies := rr.Cookies()
			rr.Header.Del("Cookie")

			for _, cookie := range cookies {
				if slices.Contains(cookieWhitelist, cookie.Name) ||
					slices.Contains(cookieSafelist, cookie.Name) {
					rr.AddCookie(cookie)
				}
			}

			next.ServeHTTP(rw, rr)
		})
	}
}
