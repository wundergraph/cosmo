package json_rpc_server

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/pb33f/libopenapi"
	v3high "github.com/pb33f/libopenapi/datamodel/high/v3"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// OpenAPILoader loads OpenAPI documents and converts them to route mappings
type OpenAPILoader struct {
	operationsDir string
	logger        *zap.Logger
}

// NewOpenAPILoader creates a new OpenAPI loader
func NewOpenAPILoader(operationsDir string, logger *zap.Logger) *OpenAPILoader {
	return &OpenAPILoader{
		operationsDir: operationsDir,
		logger:        logger,
	}
}

// LoadFromOpenAPI loads operation mappings from OpenAPI documents
func (l *OpenAPILoader) LoadFromOpenAPI() ([]RouteOperationMap, error) {
	var allMappings []RouteOperationMap

	err := filepath.WalkDir(l.operationsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and non-OpenAPI files
		if d.IsDir() || (!strings.HasSuffix(path, ".yaml") &&
			!strings.HasSuffix(path, ".yml") &&
			!strings.HasSuffix(path, ".json")) {
			return nil
		}

		// Read the OpenAPI document
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		document, err := libopenapi.NewDocument(data)
		if err != nil {
			l.logger.Warn("Skipping non-OpenAPI file", zap.String("file", path), zap.Error(err))
			return nil // Skip non-OpenAPI files
		}

		model, errs := document.BuildV3Model()
		if len(errs) > 0 {
			l.logger.Warn("Errors building OpenAPI model", zap.String("file", path), zap.Int("errors", len(errs)))
			// Continue with partial model if possible
		}

		if model == nil {
			l.logger.Warn("Empty OpenAPI model", zap.String("file", path))
			return nil
		}

		// Convert OpenAPI operations to route mappings
		mappings, err := l.convertOpenAPIToMappings(model.Model, path)
		if err != nil {
			return fmt.Errorf("failed to convert OpenAPI document %s: %w", path, err)
		}

		allMappings = append(allMappings, mappings...)
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to load OpenAPI documents from %s: %w", l.operationsDir, err)
	}

	l.logger.Info("Loaded OpenAPI operations", zap.Int("total", len(allMappings)))
	return allMappings, nil
}

// convertOpenAPIToMappings converts an OpenAPI v3 model to route mappings
func (l *OpenAPILoader) convertOpenAPIToMappings(model v3high.Document, filePath string) ([]RouteOperationMap, error) {
	var mappings []RouteOperationMap

	if model.Paths == nil || model.Paths.PathItems == nil {
		return mappings, nil
	}

	// Iterate through all paths
	for pathPattern, pathItem := range model.Paths.PathItems.FromOldest() {
		if pathItem == nil {
			continue
		}

		// Convert OpenAPI path pattern to chi router pattern
		chiPath := l.convertPathPattern(pathPattern)

		// Process each HTTP method
		operations := map[string]*v3high.Operation{
			"GET":     pathItem.Get,
			"POST":    pathItem.Post,
			"PUT":     pathItem.Put,
			"PATCH":   pathItem.Patch,
			"DELETE":  pathItem.Delete,
			"HEAD":    pathItem.Head,
			"OPTIONS": pathItem.Options,
		}

		for method, operation := range operations {
			if operation == nil {
				continue
			}

			// Extract GraphQL configuration from vendor extensions
			gqlConfig, err := l.extractGraphQLConfig(operation)
			if err != nil {
				l.logger.Warn("Failed to extract GraphQL config",
					zap.String("path", pathPattern),
					zap.String("method", method),
					zap.Error(err),
				)
				continue
			}

			if gqlConfig == nil {
				l.logger.Debug("No GraphQL configuration found",
					zap.String("path", pathPattern),
					zap.String("method", method),
				)
				continue
			}

			// Load GraphQL query if it's from a file
			gqlQuery := gqlConfig.Query
			if gqlConfig.QueryFile != "" {
				queryData, err := l.loadGraphQLQueryFromFile(gqlConfig.QueryFile)
				if err != nil {
					l.logger.Warn("Failed to load GraphQL query file",
						zap.String("file", gqlConfig.QueryFile),
						zap.Error(err),
					)
					continue
				}
				gqlQuery = queryData
			}

			if gqlQuery == "" && gqlConfig.PersistedOperationSHA == "" {
				l.logger.Warn("No GraphQL query or persisted operation found",
					zap.String("path", pathPattern),
					zap.String("method", method),
				)
				continue
			}

			// Create route mapping
			mapping := RouteOperationMap{
				Method:       method,
				Path:         chiPath,
				GQLOperation: gqlQuery,
				Variables:    l.createVariableExtractorFromOpenAPI(operation, gqlConfig.VariableMapping),
				Headers:      l.createHeaderForwarderFromOpenAPI(operation, gqlConfig.HeaderMapping),
			}

			mappings = append(mappings, mapping)

			l.logger.Debug("Created route mapping",
				zap.String("method", method),
				zap.String("path", chiPath),
				zap.String("operationId", operation.OperationId),
			)
		}
	}

	return mappings, nil
}

// loadGraphQLQueryFromFile loads a GraphQL query from a file
func (l *OpenAPILoader) loadGraphQLQueryFromFile(filename string) (string, error) {
	var fullPath string
	if filepath.IsAbs(filename) {
		fullPath = filename
	} else {
		fullPath = filepath.Join(l.operationsDir, filename)
	}

	data, err := os.ReadFile(fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to read GraphQL file %s: %w", fullPath, err)
	}

	return string(data), nil
}

// convertPathPattern converts OpenAPI path pattern to chi router pattern
// OpenAPI uses {param} while chi uses {param}
func (l *OpenAPILoader) convertPathPattern(openAPIPath string) string {
	// OpenAPI and chi use the same format for path parameters
	return openAPIPath
}

// extractGraphQLConfig extracts GraphQL configuration from vendor extensions
func (l *OpenAPILoader) extractGraphQLConfig(operation *v3high.Operation) (*GraphQLConfig, error) {
	if operation.Extensions == nil {
		return nil, nil
	}

	// Look for x-graphql vendor extension
	gqlExtension, exists := operation.Extensions.Get("x-graphql")
	if !exists {
		return nil, nil
	}

	// Parse the extension data
	return parseGraphQLExtension(gqlExtension)
}

// createVariableExtractorFromOpenAPI creates variable extractor based on OpenAPI operation and GraphQL mapping
func (l *OpenAPILoader) createVariableExtractorFromOpenAPI(operation *v3high.Operation, variableMapping *VariableMapping) func(r *http.Request) (map[string]interface{}, error) {
	return func(r *http.Request) (map[string]interface{}, error) {
		vars := make(map[string]interface{})

		if variableMapping == nil {
			return vars, nil
		}

		// Extract path parameters
		if variableMapping.PathParams != nil {
			for paramName, gqlVarName := range variableMapping.PathParams {
				if value := chi.URLParam(r, paramName); value != "" {
					// Try to convert to appropriate type based on OpenAPI schema
					convertedValue, err := l.convertParamValue(value, operation, paramName, "path")
					if err != nil {
						l.logger.Warn("Failed to convert path parameter",
							zap.String("param", paramName),
							zap.Error(err),
						)
						vars[gqlVarName] = value // fallback to string
					} else {
						vars[gqlVarName] = convertedValue
					}
				}
			}
		}

		// Extract query parameters
		if variableMapping.QueryParams != nil {
			for paramName, gqlVarName := range variableMapping.QueryParams {
				if value := r.URL.Query().Get(paramName); value != "" {
					convertedValue, err := l.convertParamValue(value, operation, paramName, "query")
					if err != nil {
						l.logger.Warn("Failed to convert query parameter",
							zap.String("param", paramName),
							zap.Error(err),
						)
						vars[gqlVarName] = value // fallback to string
					} else {
						vars[gqlVarName] = convertedValue
					}
				}
			}
		}

		// Extract headers
		if variableMapping.HeaderParams != nil {
			for headerName, gqlVarName := range variableMapping.HeaderParams {
				if value := r.Header.Get(headerName); value != "" {
					vars[gqlVarName] = value
				}
			}
		}

		// Extract body
		if variableMapping.BodyMapping != nil && (r.Method == "POST" || r.Method == "PUT" || r.Method == "PATCH") {
			body, err := l.extractBodyVariables(r, variableMapping.BodyMapping)
			if err != nil {
				return nil, fmt.Errorf("failed to extract body variables: %w", err)
			}
			for k, v := range body {
				vars[k] = v
			}
		}

		return vars, nil
	}
}

// convertParamValue converts a string parameter value to the appropriate type based on OpenAPI schema
func (l *OpenAPILoader) convertParamValue(value string, operation *v3high.Operation, paramName, paramType string) (interface{}, error) {
	if operation.Parameters == nil {
		return value, nil
	}

	// Find the parameter definition
	for _, param := range operation.Parameters {
		if param == nil || param.Name != paramName || param.In != paramType {
			continue
		}

		if param.Schema == nil {
			return value, nil
		}

		// Get the actual schema from the proxy
		schema := param.Schema.Schema()
		if schema == nil || len(schema.Type) == 0 {
			return value, nil
		}

		// Convert based on schema type (use first type if multiple)
		switch strings.ToLower(schema.Type[0]) {
		case "integer":
			if intVal, err := strconv.Atoi(value); err == nil {
				return intVal, nil
			}
		case "number":
			if floatVal, err := strconv.ParseFloat(value, 64); err == nil {
				return floatVal, nil
			}
		case "boolean":
			if boolVal, err := strconv.ParseBool(value); err == nil {
				return boolVal, nil
			}
		default:
			return value, nil
		}
	}

	return value, nil
}

// extractBodyVariables extracts variables from request body based on body mapping
func (l *OpenAPILoader) extractBodyVariables(r *http.Request, bodyMapping *BodyMapping) (map[string]interface{}, error) {
	vars := make(map[string]interface{})

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}
	r.Body = io.NopCloser(strings.NewReader(string(body))) // Reset body for other middleware

	if len(body) == 0 {
		return vars, nil
	}

	// Parse JSON body
	if !gjson.ValidBytes(body) {
		return nil, fmt.Errorf("invalid JSON in request body")
	}

	jsonBody := gjson.ParseBytes(body)

	// Apply body mapping
	if bodyMapping.WholeBody != "" {
		// Map entire body to a GraphQL variable
		var bodyObj interface{}
		if err := json.Unmarshal(body, &bodyObj); err != nil {
			return nil, fmt.Errorf("failed to unmarshal body: %w", err)
		}
		vars[bodyMapping.WholeBody] = bodyObj
	}

	// Map specific fields
	if bodyMapping.FieldMappings != nil {
		for jsonPath, gqlVarName := range bodyMapping.FieldMappings {
			if result := jsonBody.Get(jsonPath); result.Exists() {
				vars[gqlVarName] = result.Value()
			}
		}
	}

	return vars, nil
}

// createHeaderForwarderFromOpenAPI creates header forwarder based on OpenAPI operation
func (l *OpenAPILoader) createHeaderForwarderFromOpenAPI(operation *v3high.Operation, headerMapping *HeaderMapping) func(r *http.Request) map[string][]string {
	return func(r *http.Request) map[string][]string {
		headers := make(map[string][]string)

		if headerMapping == nil {
			return headers
		}

		// Forward specified headers
		if headerMapping.Forward != nil {
			for _, headerName := range headerMapping.Forward {
				if values := r.Header[headerName]; len(values) > 0 {
					headers[headerName] = values
				}
			}
		}

		// Add custom headers
		if headerMapping.Add != nil {
			for key, value := range headerMapping.Add {
				headers[key] = []string{value}
			}
		}

		// Map headers to different names
		if headerMapping.Map != nil {
			for sourceHeader, targetHeader := range headerMapping.Map {
				if values := r.Header[sourceHeader]; len(values) > 0 {
					headers[targetHeader] = values
				}
			}
		}

		return headers
	}
}
