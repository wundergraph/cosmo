package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCookieWhitelist(t *testing.T) {
	t.Parallel()

	t.Run("should remove no cookies by default", func(t *testing.T) {
		t.Parallel()

		cookieWhitelist := []string{}
		cookies := []*http.Cookie{
			{
				Name:  "allowed",
				Value: "allowed",
			},
		}

		recorder := httptest.NewRecorder()

		filteredCookies := []*http.Cookie{}

		next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			filteredCookies = r.Cookies()
		})

		req, err := http.NewRequest(http.MethodGet, "/", strings.NewReader("test"))
		require.NoError(t, err)

		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}

		CookieWhitelist(cookieWhitelist, []string{})(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusOK, recorder.Code)
		require.Equal(t, cookies, filteredCookies)
	})

	t.Run("should only allow whitelisted cookies", func(t *testing.T) {
		t.Parallel()

		cookieWhitelist := []string{"allowed"}
		cookies := []*http.Cookie{
			{
				Name:  "allowed",
				Value: "allowed",
			},
			{
				Name:  "disallowed",
				Value: "disallowed",
			},
		}

		expectedFilteredCookies := []*http.Cookie{
			{
				Name:  "allowed",
				Value: "allowed",
			},
		}

		recorder := httptest.NewRecorder()

		filteredCookies := []*http.Cookie{}

		next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			filteredCookies = r.Cookies()
		})

		req, err := http.NewRequest(http.MethodGet, "/", strings.NewReader("test"))
		require.NoError(t, err)

		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}

		CookieWhitelist(cookieWhitelist, []string{})(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusOK, recorder.Code)
		require.Equal(t, expectedFilteredCookies, filteredCookies)
	})

	t.Run("never filter safe listed cookie", func(t *testing.T) {
		t.Parallel()

		cookieWhitelist := []string{"allowed"}
		cookies := []*http.Cookie{
			{
				Name:  "allowed",
				Value: "allowed",
			},
			{
				Name:  "disallowed",
				Value: "disallowed",
			},
			{
				Name:  "safelisted",
				Value: "safelisted",
			},
		}

		expectedFilteredCookies := []*http.Cookie{
			{
				Name:  "allowed",
				Value: "allowed",
			},
			{
				Name:  "safelisted",
				Value: "safelisted",
			},
		}

		recorder := httptest.NewRecorder()

		filteredCookies := []*http.Cookie{}

		next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			filteredCookies = r.Cookies()
		})

		req, err := http.NewRequest(http.MethodGet, "/", strings.NewReader("test"))
		require.NoError(t, err)

		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}

		CookieWhitelist(cookieWhitelist, []string{"safelisted"})(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusOK, recorder.Code)
		require.Equal(t, expectedFilteredCookies, filteredCookies)
	})
}
