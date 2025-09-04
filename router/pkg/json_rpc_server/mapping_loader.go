package json_rpc_server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

// OperationMapping represents a single operation mapping from YAML
type OperationMapping struct {
	Method       string         `yaml:"method"`
	Path         string         `yaml:"path"`
	OperationID  string         `yaml:"operation_id"`
	GQLOperation string         `yaml:"gql_operation,omitempty"`
	GQLFile      string         `yaml:"gql_file,omitempty"`
	Variables    VariableConfig `yaml:"variables,omitempty"`
	Headers      HeaderConfig   `yaml:"headers,omitempty"`
}

// VariableConfig defines how to extract variables from HTTP requests
type VariableConfig struct {
	PathParams  map[string]string `yaml:"path_params,omitempty"`
	QueryParams map[string]string `yaml:"query_params,omitempty"`
	Body        string            `yaml:"body,omitempty"`
}

// HeaderConfig defines which headers to forward
type HeaderConfig struct {
	Forward []string          `yaml:"forward,omitempty"`
	Add     map[string]string `yaml:"add,omitempty"`
}

// OperationConfig represents the structure of a YAML mapping file
type OperationConfig struct {
	Name        string             `yaml:"name"`
	Description string             `yaml:"description,omitempty"`
	Operations  []OperationMapping `yaml:"operations"`
}

// MappingLoader loads operation mappings from YAML files
type MappingLoader struct {
	operationsDir string
}

// NewMappingLoader creates a new mapping loader
func NewMappingLoader(operationsDir string) *MappingLoader {
	return &MappingLoader{
		operationsDir: operationsDir,
	}
}

// LoadMappings loads all operation mappings from YAML files in the directory
func (l *MappingLoader) LoadMappings() ([]RouteOperationMap, error) {
	var allMappings []RouteOperationMap

	err := filepath.WalkDir(l.operationsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and non-YAML files
		if d.IsDir() || (!strings.HasSuffix(path, ".yaml") && !strings.HasSuffix(path, ".yml")) {
			return nil
		}

		// Load YAML file
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		var config OperationConfig
		if err := yaml.Unmarshal(data, &config); err != nil {
			return fmt.Errorf("failed to parse %s: %w", path, err)
		}

		// Convert each operation to RouteOperationMap
		for _, op := range config.Operations {
			mapping, err := l.convertToRouteOperationMap(op)
			if err != nil {
				return fmt.Errorf("failed to convert operation %s in %s: %w", op.OperationID, path, err)
			}
			allMappings = append(allMappings, mapping)
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to load mappings from %s: %w", l.operationsDir, err)
	}

	return allMappings, nil
}

// convertToRouteOperationMap converts an OperationMapping to RouteOperationMap
func (l *MappingLoader) convertToRouteOperationMap(op OperationMapping) (RouteOperationMap, error) {
	var gqlOperation string

	// Load GraphQL from file or use inline
	if op.GQLFile != "" {
		gqlPath := filepath.Join(l.operationsDir, op.GQLFile)
		data, err := os.ReadFile(gqlPath)
		if err != nil {
			return RouteOperationMap{}, fmt.Errorf("failed to read GraphQL file %s: %w", gqlPath, err)
		}
		gqlOperation = string(data)
	} else if op.GQLOperation != "" {
		gqlOperation = op.GQLOperation
	} else {
		return RouteOperationMap{}, fmt.Errorf("operation %s must have either gql_operation or gql_file", op.OperationID)
	}

	return RouteOperationMap{
		Method:       op.Method,
		Path:         op.Path,
		GQLOperation: gqlOperation,
		Variables:    l.createVariableExtractor(op.Variables),
		Headers:      l.createHeaderForwarder(op.Headers),
	}, nil
}

// createVariableExtractor creates a function to extract variables from HTTP requests
func (l *MappingLoader) createVariableExtractor(config VariableConfig) func(r *http.Request) (map[string]interface{}, error) {
	return func(r *http.Request) (map[string]interface{}, error) {
		vars := make(map[string]interface{})

		// Extract path parameters
		for paramName, varName := range config.PathParams {
			if value := chi.URLParam(r, paramName); value != "" {
				vars[varName] = value
			}
		}

		// Extract query parameters
		for paramName, varName := range config.QueryParams {
			if value := r.URL.Query().Get(paramName); value != "" {
				vars[varName] = value
			}
		}

		// Extract body (for POST requests)
		if config.Body != "" && r.Method == "POST" {
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return nil, fmt.Errorf("failed to decode request body: %w", err)
			}
			vars[config.Body] = body
		}

		return vars, nil
	}
}

// createHeaderForwarder creates a function to forward headers
func (l *MappingLoader) createHeaderForwarder(config HeaderConfig) func(r *http.Request) map[string][]string {
	return func(r *http.Request) map[string][]string {
		headers := make(map[string][]string)

		// Forward specified headers
		for _, headerName := range config.Forward {
			if values := r.Header[headerName]; len(values) > 0 {
				headers[headerName] = values
			}
		}

		// Add custom headers
		for key, value := range config.Add {
			headers[key] = []string{value}
		}

		return headers
	}
}
