package json_rpc_server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type RouteOperationMap struct {
	Method       string
	Path         string
	GQLOperation string
	Variables    func(r *http.Request) (map[string]interface{}, error)
	Headers      func(r *http.Request) map[string][]string
}

type GraphQLClient struct {
	HTTPClient *http.Client
	Endpoint   string
}

func NewGraphQLClient(httpClient *http.Client, endpoint string) *GraphQLClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &GraphQLClient{
		HTTPClient: httpClient,
		Endpoint:   endpoint,
	}
}

func RegisterRoutes(r chi.Router, routes []RouteOperationMap, gqlClient *GraphQLClient) {
	for _, route := range routes {
		route := route // capture loop variable

		handler := func(w http.ResponseWriter, r *http.Request) {
			vars, err := route.Variables(r)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "Failed to extract variables", err)
				return
			}

			payload := map[string]interface{}{
				"query":     route.GQLOperation,
				"variables": vars,
			}

			buf, err := json.Marshal(payload)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "Failed to marshal GraphQL request", err)
				return
			}

			// Create HTTP request to GraphQL endpoint
			req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gqlClient.Endpoint, bytes.NewBuffer(buf))
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "Failed to create GraphQL request", err)
				return
			}
			req.Header.Set("Content-Type", "application/json")

			if route.Headers != nil {
				if hdrs := route.Headers(r); hdrs != nil {
					for k, values := range hdrs {
						for _, v := range values {
							if v != "" {
								req.Header.Add(k, v)
							}
						}
					}
				}
			}

			resp, err := gqlClient.HTTPClient.Do(req)
			if err != nil {
				writeJSONError(w, http.StatusBadGateway, "Failed to execute GraphQL request", err)
				return
			}
			defer resp.Body.Close()

			// Forward response
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
		}

		r.MethodFunc(route.Method, route.Path, handler)
	}
}

func writeJSONError(w http.ResponseWriter, statusCode int, message string, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	errorResponse := map[string]interface{}{
		"error": map[string]interface{}{
			"message": message,
			"code":    statusCode,
		},
	}

	if err != nil {
		errorResponse["error"].(map[string]interface{})["details"] = err.Error()
	}

	json.NewEncoder(w).Encode(errorResponse)
}
