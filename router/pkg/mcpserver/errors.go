package mcpserver

// JSON-RPC 2.0 and MCP error codes
//
// Error code ranges:
// - Standard JSON-RPC 2.0: -32768 to -32000 (reserved by JSON-RPC spec)
// - Server errors (implementation-defined): -32000 to -32099 (within JSON-RPC reserved range)
// - Application errors: Must use codes outside -32768 to -32000 to avoid conflicts with JSON-RPC reserved codes
const (
	// Standard JSON-RPC 2.0 error codes
	ErrorCodeParseError     = -32700 // Invalid JSON was received by the server
	ErrorCodeInvalidRequest = -32600 // The JSON sent is not a valid Request object
	ErrorCodeMethodNotFound = -32601 // The method does not exist / is not available
	ErrorCodeInvalidParams  = -32602 // Invalid method parameter(s)
	ErrorCodeInternalError  = -32603 // Internal JSON-RPC error

	// MCP-specific error codes (from MCP specification)
	// See: https://spec.modelcontextprotocol.io/specification/basic/errors/
	ErrorCodeResourceNotFound = -32002 // Requested resource was not found

	// Custom Cosmo MCP server error codes
	// These use the reserved range -32000 to -32099 for implementation-defined server errors
	ErrorCodeAuthenticationRequired = -32001 // Authentication required (OAuth/JWT)
	ErrorCodeInsufficientScope      = -32003 // Token lacks required OAuth scopes (RFC 6750)
)

// Error messages
const (
	ErrorMessageAuthenticationRequired = "Authentication required"
	ErrorMessageInsufficientScope      = "Insufficient scope"
	ErrorMessageResourceNotFound       = "Resource not found"
	ErrorMessageInvalidParams          = "Invalid params"
	ErrorMessageInternalError          = "Internal error"
)
