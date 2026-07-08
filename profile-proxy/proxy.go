package main

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	echojwt "github.com/labstack/echo-jwt/v5"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

const (
	labelOrganizationID   = "organization_id"
	labelFederatedGraphID = "federated_graph_id"
)

func newServer(cfg Config, logger *slog.Logger) *echo.Echo {
	e := echo.New()

	e.Logger = logger

	e.Use(middleware.Recover())

	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		Skipper:        func(c *echo.Context) bool { return c.Path() == "/healthz" },
		LogStatus:      true,
		LogMethod:      true,
		LogURIPath:     true,
		LogLatency:     true,
		LogRemoteIP:    true,
		LogQueryParams: []string{"name"},
		HandleError:    true, // forwards the error to the global error handler so it can pick the status code
		LogValuesFunc: func(c *echo.Context, v middleware.RequestLoggerValues) error {
			level := slog.LevelInfo
			attrs := []slog.Attr{
				slog.String("method", v.Method),
				slog.String("path", v.URIPath),
				slog.Int("status", v.Status),
				slog.Duration("latency", v.Latency),
				slog.String("remote_ip", v.RemoteIP),
			}
			if v.Error != nil {
				level = slog.LevelError
				attrs = append(attrs, slog.String("err", v.Error.Error()))
			}
			logger.LogAttrs(context.Background(), level, "request", attrs...)
			return nil
		},
	}))

	e.GET("/healthz", func(c *echo.Context) error { return c.NoContent(http.StatusOK) })

	// /ingest is served entirely by its middleware chain:
	// - echo-jwt verifies the graph token
	// - rewriteForUpstream turns claims into labels and swaps auth
	// - echo's proxy middleware forwards to the upstream without ever calling the route handler
	e.POST("/ingest", func(*echo.Context) error { return echo.ErrBadGateway },
		echojwt.WithConfig(echojwt.Config{
			SigningKey:    []byte(cfg.JWTSecret),
			SigningMethod: echojwt.AlgorithmHS256, // pin alg; blocks "none" and RS/HS confusion
			NewClaimsFunc: func(*echo.Context) jwt.Claims { return new(GraphKeyClaims) },
		}),
		rewriteForUpstream(cfg),
		middleware.Proxy(middleware.NewRoundRobinBalancer(
			[]*middleware.ProxyTarget{{URL: &cfg.UpstreamURL}},
		)),
	)

	return e
}

// rewriteForUpstream turns the verified graph token claims into profile labels
// and swaps client auth for upstream auth before the proxy middleware forwards
// the request. The profile body is streamed through untouched (never decoded).
func rewriteForUpstream(cfg Config) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			token, err := echo.ContextGet[*jwt.Token](c, "user")
			if err != nil {
				return echo.ErrUnauthorized.Wrap(err)
			}

			claims := token.Claims.(*GraphKeyClaims)
			orgID := sanitizeValue(claims.OrganizationID)
			graphID := sanitizeValue(claims.FederatedGraphID)

			// rewrite the `name` query param: app{k=v,...}, sorted, matching pyroscope's Normalized()
			r := c.Request()
			q := r.URL.Query()
			q.Set("name", rewriteName(q.Get("name"), map[string]string{
				labelOrganizationID:   orgID,
				labelFederatedGraphID: graphID,
			}))
			r.URL.RawQuery = q.Encode()

			// auth exchange: drop the client JWT, present upstream BasicAuth like a
			// normal pyroscope-go client (SetBasicAuth == the SDK's request.SetBasicAuth)
			r.Header.Del("Authorization")
			if cfg.UpstreamUser != "" && cfg.UpstreamPassword != "" {
				r.SetBasicAuth(cfg.UpstreamUser, cfg.UpstreamPassword)
			}

			// X-Scope-OrgID selects the tenant in multi-tenant Grafana backends
			// (Pyroscope/Mimir/Loki); it must come from the verified token, never
			// the client. Ignored by single-tenant Pyroscope.
			r.Header.Del("X-Scope-OrgID")
			if cfg.TenantFromOrgID {
				r.Header.Set("X-Scope-OrgID", orgID)
			}

			r.Host = cfg.UpstreamURL.Host // route to the upstream vhost
			return next(c)
		}
	}
}
