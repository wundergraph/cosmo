package json_rpc_server

import (
	"encoding/json"
	"fmt"

	"github.com/tidwall/gjson"
)

// GraphQLConfig represents the x-graphql vendor extension configuration
type GraphQLConfig struct {
	// GraphQL query, mutation, or subscription
	Query string `json:"query,omitempty"`

	// Alternative: reference to a GraphQL file
	QueryFile string `json:"queryFile,omitempty"`

	// Operation name for the GraphQL operation (optional)
	OperationName string `json:"operationName,omitempty"`

	// Persisted operation SHA (alternative to query/queryFile)
	PersistedOperationSHA string `json:"persistedOperationSHA,omitempty"`

	// Variable mapping configuration
	VariableMapping *VariableMapping `json:"variableMapping,omitempty"`

	// Header mapping configuration
	HeaderMapping *HeaderMapping `json:"headerMapping,omitempty"`

	// Response mapping configuration (future use)
	ResponseMapping *ResponseMapping `json:"responseMapping,omitempty"`

	// Error mapping configuration (future use)
	ErrorMapping *ErrorMapping `json:"errorMapping,omitempty"`
}

// VariableMapping defines how to extract and map REST request data to GraphQL variables
type VariableMapping struct {
	// Map path parameters to GraphQL variables
	// Key: OpenAPI path parameter name, Value: GraphQL variable name
	PathParams map[string]string `json:"pathParams,omitempty"`

	// Map query parameters to GraphQL variables
	// Key: query parameter name, Value: GraphQL variable name
	QueryParams map[string]string `json:"queryParams,omitempty"`

	// Map headers to GraphQL variables
	// Key: header name, Value: GraphQL variable name
	HeaderParams map[string]string `json:"headerParams,omitempty"`

	// Body mapping configuration
	BodyMapping *BodyMapping `json:"bodyMapping,omitempty"`
}

// BodyMapping defines how to extract data from request body
type BodyMapping struct {
	// Map entire body to a GraphQL variable
	WholeBody string `json:"wholeBody,omitempty"`

	// Map specific fields from body using JSON path
	// Key: JSON path (e.g., "user.name"), Value: GraphQL variable name
	FieldMappings map[string]string `json:"fieldMappings,omitempty"`
}

// HeaderMapping defines how to handle request headers when calling GraphQL
type HeaderMapping struct {
	// List of headers to forward as-is
	Forward []string `json:"forward,omitempty"`

	// Headers to add with static values
	// Key: header name, Value: header value
	Add map[string]string `json:"add,omitempty"`

	// Map headers to different names
	// Key: source header name, Value: target header name
	Map map[string]string `json:"map,omitempty"`
}

// ResponseMapping defines how to transform GraphQL response to REST response (future use)
type ResponseMapping struct {
	// JSON path to extract data from GraphQL response
	DataPath string `json:"dataPath,omitempty"`

	// Custom response transformations
	FieldMappings map[string]string `json:"fieldMappings,omitempty"`
}

// ErrorMapping defines how to transform GraphQL errors to REST errors (future use)
type ErrorMapping struct {
	// Map GraphQL error codes to HTTP status codes
	StatusCodeMappings map[string]int `json:"statusCodeMappings,omitempty"`

	// Custom error message transformations
	MessageMappings map[string]string `json:"messageMappings,omitempty"`
}

// parseGraphQLExtension parses the x-graphql vendor extension
func parseGraphQLExtension(extension interface{}) (*GraphQLConfig, error) {
	// Convert extension to JSON bytes
	extensionBytes, err := json.Marshal(extension)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal extension: %w", err)
	}

	// Validate it's valid JSON
	if !gjson.ValidBytes(extensionBytes) {
		return nil, fmt.Errorf("invalid JSON in x-graphql extension")
	}

	// Parse into GraphQLConfig struct
	var config GraphQLConfig
	if err := json.Unmarshal(extensionBytes, &config); err != nil {
		return nil, fmt.Errorf("failed to parse x-graphql extension: %w", err)
	}

	// Validate the configuration
	if err := validateGraphQLConfig(&config); err != nil {
		return nil, fmt.Errorf("invalid x-graphql configuration: %w", err)
	}

	return &config, nil
}

// validateGraphQLConfig validates the GraphQL configuration
func validateGraphQLConfig(config *GraphQLConfig) error {
	// Must have either query, queryFile, or persistedOperationSHA
	if config.Query == "" && config.QueryFile == "" && config.PersistedOperationSHA == "" {
		return fmt.Errorf("must specify either 'query', 'queryFile', or 'persistedOperationSHA'")
	}

	// Cannot have multiple query sources
	nonEmptyCount := 0
	if config.Query != "" {
		nonEmptyCount++
	}
	if config.QueryFile != "" {
		nonEmptyCount++
	}
	if config.PersistedOperationSHA != "" {
		nonEmptyCount++
	}

	if nonEmptyCount > 1 {
		return fmt.Errorf("can only specify one of 'query', 'queryFile', or 'persistedOperationSHA'")
	}

	return nil
}

// Example usage in OpenAPI document:
/*
openapi: 3.0.0
info:
  title: User API
  version: 1.0.0
paths:
  /api/users/{id}:
    get:
      summary: Get user by ID
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User details
          content:
            application/json:
              schema:
                type: object
      x-graphql:
        query: |
          query GetUser($userId: ID!) {
            user(id: $userId) {
              id
              name
              email
              createdAt
            }
          }
        variableMapping:
          pathParams:
            id: "userId"
        headerMapping:
          forward:
            - "Authorization"
            - "X-Request-ID"
          add:
            X-Source: "rest-api"

  /api/users:
    post:
      summary: Create user
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
                - email
              properties:
                name:
                  type: string
                email:
                  type: string
      responses:
        '201':
          description: User created
      x-graphql:
        query: |
          mutation CreateUser($input: CreateUserInput!) {
            createUser(input: $input) {
              id
              name
              email
              createdAt
            }
          }
        variableMapping:
          bodyMapping:
            wholeBody: "input"
        headerMapping:
          forward:
            - "Authorization"
*/
