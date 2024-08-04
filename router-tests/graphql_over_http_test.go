package integration

import (
	"bytes"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestGraphQLOverHTTPCompatibility(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("valid request should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("valid request with Operation Name null should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"operationName": null,"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("return 400 bad request when variables is not a map", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":true}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"variables must be an object"}],"data":null}`, string(data))
		})
		t.Run("return 400 bad request when extensions is not a map", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","extensions":true}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing extensions: expected { character for map value"}],"data":null}`, string(data))
		})
		t.Run("valid request with Operation Name should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("malformed JSON should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body: unexpected character 'q'"}],"data":null}`, string(data))
		})
		t.Run("malformed JSON variant should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{{"query":query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body: json: invalid character { as string"}],"data":null}`, string(data))
		})
		t.Run("malformed JSON variant #2 should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}],"data":null}`, string(data))
		})
		t.Run("malformed JSON variables variant should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":GERMAN}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body: unexpected character 'G'"}],"data":null}`, string(data))
		})
		t.Run("missing variables should return 200 OK with validation errors response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}"}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, string(data))
		})
		t.Run("mismatching variables although valid JSON should not be 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"whatever":123}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, string(data))
		})
		t.Run("variables null should be 200 ok with validation error", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":null}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, string(data))
		})
		t.Run("variables null with space should be 200 ok with validation error", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":  null }`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, string(data))
		})
		t.Run("request with spaces and tabs should be 200 ok", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte("{\n\"query\":\"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}\"\n,\t\"variables\"\n\t:\n\t{\"criteria\":\n\t{\"nationality\"\n\t:\n\t\"GERMAN\"}}\n}")
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
	})
}
