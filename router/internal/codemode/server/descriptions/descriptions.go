// Package descriptions holds the markdown text used as MCP server, tool, and
// resource descriptions for the Code Mode server. Each description lives in its
// own .md file and is embedded at compile time so prose can be edited without
// touching Go source. go:embed only supports vars (not consts), so each export
// is a package-level string treated as immutable.
package descriptions

import (
	_ "embed"
	"strings"
)

//go:embed search_tool.md
var rawSearchTool string

//go:embed execute_tool.md
var rawExecuteTool string

//go:embed execute_source.md
var rawExecuteSource string

//go:embed persisted_ops_resource.md
var rawPersistedOpsResource string

// SearchTool is the description of the code_mode_search_tools MCP tool.
var SearchTool = strings.TrimRight(rawSearchTool, "\n")

// ExecuteTool is the description of the code_mode_run_js MCP tool.
var ExecuteTool = strings.TrimRight(rawExecuteTool, "\n")

// ExecuteSource is the description of the `source` input parameter of the
// code_mode_run_js MCP tool.
var ExecuteSource = strings.TrimRight(rawExecuteSource, "\n")

// PersistedOpsResource is the description of the yoko://persisted-ops.d.ts MCP
// resource.
var PersistedOpsResource = strings.TrimRight(rawPersistedOpsResource, "\n")
