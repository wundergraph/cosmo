package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/querygen"
)

// symbolKinds are the kinds that the discovery service understands. The tool
// schema constrains the input to this list, so an agent cannot send a kind that
// silently matches nothing.
var symbolKinds = []string{
	"object", "interface", "union", "enum", "scalar",
	"input", "field", "input_field", "path",
}

// schemaDiscoveryToolNames are the tools that this file registers.
var schemaDiscoveryToolNames = []string{"search_schema", "get_symbols", "generate_query"}

// schemaDiscoveryInstructions is the cross-tool workflow. The router serves it
// as the MCP server instructions only when the operator sets no value of their
// own.
const schemaDiscoveryInstructions = `This server exposes a GraphQL API. The schema is too large to read in full.

Follow these steps:
1. Use search_schema to find the parts of the schema that relate to your task.
2. Use get_symbols to read the full record for a coordinate that looks correct.
3. Use generate_query to make a validated GraphQL operation from your intent.

Use generate_query first when you already know the data that you want. Use
search_schema first when you must find out what the API can do.

Read the unsatisfied field of a generate_query result. An empty queries list with
one unsatisfied reason means that the schema cannot answer the request. The
capability does not exist. Do not try other wordings.`

// searchSchemaInput defines the input of the search_schema tool.
type searchSchemaInput struct {
	Query     string   `json:"query"`
	Kinds     []string `json:"kinds,omitempty"`
	Limit     int32    `json:"limit,omitempty"`
	Parent    string   `json:"parent,omitempty"`
	Paginated *bool    `json:"paginated,omitempty"`
}

// getSymbolsInput defines the input of the get_symbols tool.
type getSymbolsInput struct {
	Coordinates []string `json:"coordinates"`
}

// generateQueryInput defines the input of the generate_query tool.
type generateQueryInput struct {
	Prompt string `json:"prompt"`
}

// registerSchemaDiscoveryTools adds the schema discovery tools.
//
// Call this before the operations loop. The collision check in registerTools
// then sees these names in registeredTools, so an operation with the same name
// is skipped instead of overwriting a tool.
func (s *GraphQLSchemaServer) registerSchemaDiscoveryTools() {
	if s.schemaDiscovery == nil {
		return
	}

	readOnly := true
	openWorld := true

	searchTool := &mcp.Tool{
		Name: "search_schema",
		Description: "Search the schema for elements that relate to a topic. The search does not load the full schema.\n\n" +
			"The search finds elements by meaning. It also finds elements when the names do not contain your words. The results have a rank.\n\n" +
			"Use this tool to find out if the API already does something. Use it before you write an operation. Use it before you build a new feature.\n\n" +
			"The tool returns coordinates in the form kind:Type.field. Each coordinate has a description. Then use get_symbols to read a full record. Or use generate_query if you know your intent.\n\n" +
			"Rules for the input:\n" +
			"- Write the topic in your own words.\n" +
			"- Do not guess field names.\n" +
			"- Set kinds to [\"field\"] to find operations and data.\n" +
			"- Set kinds to [\"object\"] to find types.\n" +
			"- Set parent to \"object:Query\" to find read entry points.\n" +
			"- Set parent to \"object:Mutation\" to find write entry points.\n" +
			"- Set parent to \"object:TypeName\" to find the fields of one type.\n" +
			"- Use a low limit value. The payloads are large.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The topic to search for, in your own words.",
				},
				"kinds": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string", "enum": symbolKinds},
					"description": "Restrict the search to these kinds of schema element.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "The number of hits to return. The default is 10.",
				},
				"parent": map[string]any{
					"type":        "string",
					"description": "Restrict the search to the members of one coordinate, for example \"object:Query\".",
				},
				"paginated": map[string]any{
					"type":        "boolean",
					"description": "Set true to keep only Relay connection fields. Set false to remove them.",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
		Annotations: &mcp.ToolAnnotations{
			Title:         "Search GraphQL Schema",
			ReadOnlyHint:  readOnly,
			OpenWorldHint: &openWorld,
		},
	}
	s.server.AddTool(searchTool, s.handleSearchSchema())

	symbolsTool := &mcp.Tool{
		Name: "get_symbols",
		Description: "Read the full record for each coordinate that you give. A record contains the type, the arguments, the description, and the parent.\n\n" +
			"Use this tool after search_schema. Use it when a result looks correct and you need the exact signature.\n\n" +
			"A coordinate has one of these forms:\n" +
			"- field:Type.fieldName\n" +
			"- object:TypeName\n" +
			"- input:TypeName\n" +
			"- enum:TypeName\n\n" +
			"Rules for the input:\n" +
			"- Copy each coordinate from a search_schema result.\n" +
			"- Do not guess a coordinate.\n" +
			"- Give all the coordinates that you need in one call.\n\n" +
			"The response omits a coordinate if the index does not hold it. A short response is not an error.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"coordinates": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"minItems":    1,
					"description": "The coordinates to read. Copy each one from a search_schema result.",
				},
			},
			"required":             []string{"coordinates"},
			"additionalProperties": false,
		},
		Annotations: &mcp.ToolAnnotations{
			Title:         "Get Schema Symbols",
			ReadOnlyHint:  readOnly,
			OpenWorldHint: &openWorld,
		},
	}
	s.server.AddTool(symbolsTool, s.handleGetSymbols())

	generateTool := &mcp.Tool{
		Name: "generate_query",
		Description: "This tool takes 10 to 30 seconds. Call it one time and keep the result.\n\n" +
			"Make a GraphQL operation from a description of the data that you want. The tool checks the operation against the schema before it returns it. Every field in the operation exists.\n\n" +
			"Use this tool when you know the data that you want, but not how the schema shows it. This tool does not put the schema into your context.\n\n" +
			"Rules for the prompt:\n" +
			"- Write the data that you want in your own words.\n" +
			"- Name the entities and the fields that you want.\n" +
			"- Give the filter conditions and the sort order.\n" +
			"- Do not write GraphQL syntax.\n" +
			"- Do not guess type names.\n\n" +
			"The operation is parameterized. A value in your prompt becomes a GraphQL variable. It does not become a literal. One operation thus serves many different inputs.\n\n" +
			"Always read the unsatisfied field. An empty queries list with one unsatisfied entry means that the schema cannot answer your request. This result is correct. It is not a failure. It tells you that the capability does not exist. Build the capability.\n\n" +
			"Use the result in one of two ways:\n" +
			"- Run the operation against the router with the variables.\n" +
			"- Save the operation as a persisted operation. Deploy it to expose the operation as a tool.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt": map[string]any{
					"type":        "string",
					"description": "A description of the data that you want, in your own words.",
				},
			},
			"required":             []string{"prompt"},
			"additionalProperties": false,
		},
		Annotations: &mcp.ToolAnnotations{
			Title:         "Generate GraphQL Operation",
			ReadOnlyHint:  readOnly,
			OpenWorldHint: &openWorld,
		},
	}
	s.server.AddTool(generateTool, s.handleGenerateQuery())

	s.registeredTools = append(s.registeredTools, schemaDiscoveryToolNames...)
}

// handleSearchSchema returns the handler of the search_schema tool.
func (s *GraphQLSchemaServer) handleSearchSchema() mcp.ToolHandler {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input searchSchemaInput
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil {
			return nil, fmt.Errorf("failed to read the tool input: %w", err)
		}

		res, err := s.schemaDiscovery.SearchSchema(ctx, querygen.SearchInput{
			Query:     input.Query,
			Kinds:     input.Kinds,
			Limit:     input.Limit,
			Parent:    input.Parent,
			Paginated: input.Paginated,
		})
		if err != nil {
			return s.schemaDiscoveryError("search_schema", err), nil
		}

		return jsonToolResult(res)
	}
}

// handleGetSymbols returns the handler of the get_symbols tool.
func (s *GraphQLSchemaServer) handleGetSymbols() mcp.ToolHandler {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input getSymbolsInput
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil {
			return nil, fmt.Errorf("failed to read the tool input: %w", err)
		}

		res, err := s.schemaDiscovery.GetSymbols(ctx, input.Coordinates)
		if err != nil {
			return s.schemaDiscoveryError("get_symbols", err), nil
		}

		return jsonToolResult(res)
	}
}

// handleGenerateQuery returns the handler of the generate_query tool.
func (s *GraphQLSchemaServer) handleGenerateQuery() mcp.ToolHandler {
	return func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input generateQueryInput
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil {
			return nil, fmt.Errorf("failed to read the tool input: %w", err)
		}

		res, err := s.schemaDiscovery.GenerateQuery(ctx, input.Prompt)
		if err != nil {
			return s.schemaDiscoveryError("generate_query", err), nil
		}

		return jsonToolResult(res)
	}
}

// schemaDiscoveryError turns an error into a tool result that a caller can act
// on.
//
// The tools return no protocol error. An agent reads a tool result and acts on
// it. An agent cannot act on a transport failure.
func (s *GraphQLSchemaServer) schemaDiscoveryError(tool string, err error) *mcp.CallToolResult {
	s.logger.Debug("schema discovery tool failed",
		zap.String("tool", tool),
		zap.Error(err))

	return &mcp.CallToolResult{
		IsError: true,
		Content: []mcp.Content{&mcp.TextContent{Text: querygen.UserMessage(err)}},
	}
}

// jsonToolResult marshals a value into a tool result.
func jsonToolResult(v any) (*mcp.CallToolResult, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("failed to write the tool result: %w", err)
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, nil
}
