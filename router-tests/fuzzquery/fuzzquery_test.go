package fuzzquery

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"net/http"
	"testing"
)

type testQuery struct {
	Name      string
	Body      string
	Variables map[string]interface{}
}

func (t *testQuery) Data() []byte {
	name := t.Name
	if name == "" {
		name = testenv.RandString(10)
	}
	values := map[string]interface{}{
		"query":         fmt.Sprintf("query %s %s", name, t.Body),
		"operationName": name,
	}
	if len(t.Variables) > 0 {
		values["variables"] = t.Variables
	}
	data, err := json.Marshal(values)
	if err != nil {
		panic(err)
	}
	return data
}

func FuzzQuery(f *testing.F) {
	corpus := []struct {
		Query     string
		Variables []byte // As JSON
	}{
		{
			Query: "{ employees { id } }",
		},
		{
			Query: `($team:Department!= MARKETING) {
				team_mates(team:$team) {
				  id
				}
			  }`,
			Variables: []byte(`{"team":"MARKETING"}`),
		},
		{
			Query:     `($n:Int!) { employee(id:$n) { id } }`,
			Variables: []byte(`{"n":4}`),
		},
	}
	for _, tc := range corpus {
		f.Add(tc.Query, tc.Variables)
	}
	f.Fuzz(func(t *testing.T, query string, variables []byte) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var q testQuery
			if err := json.Unmarshal(variables, &q.Variables); err != nil {
				// Invalid JSON, mark as uninteresting input
				t.Skip()
			}
			q.Body = query

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     query,
				Variables: variables,
			})
			require.NoError(t, err)
			if res.Response.StatusCode != http.StatusOK && res.Response.StatusCode != http.StatusBadRequest {
				t.Error("unexpected status code", res.Response.StatusCode)
			}
		})
	})
}
