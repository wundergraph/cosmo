package mcpserver

import (
	"testing"
)

func TestToSnakeCase(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
	}{
		{"", ""},
		{"hello", "hello"},
		{"helloWorld", "hello_world"},
		{"HelloWorld", "hello_world"},
		{"hello-world", "hello_world"},
		{"hello world", "hello_world"},
		{"GetUserByID", "get_user_by_id"},
		{"ListGraphQLOperations", "list_graph_ql_operations"},
		{"My GraphQL Query", "my_graph_ql_query"},
		{"FetchUserData", "fetch_user_data"},
		{"FetchURL", "fetch_url"},
		{"listUsers", "list_users"},
		{"APIEndpoint", "api_endpoint"},
		{"URLParser", "url_parser"},
		{"HTTPRequest", "http_request"},
		{"SQLQuery", "sql_query"},
		{"OAuthToken", "oauth_token"},
		{"userID", "user_id"},
		{"userIDAndName", "user_id_and_name"},
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			result := toSnakeCase(tc.input)
			if result != tc.expected {
				t.Errorf("toSnakeCase(%q) = %q, expected %q", tc.input, result, tc.expected)
			}
		})
	}
}
