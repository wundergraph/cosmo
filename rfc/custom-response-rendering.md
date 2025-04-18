---
title: "RFC: Custom Response Rendering"
author: Jens Neuse
---

# RFC: Custom Response Rendering

## Overview

This RFC proposes extending the Cosmo Router to support custom response rendering through a flexible hook system. This will allow users to implement advanced data privacy, response transformation, and other custom rendering logic by providing their own render functions.

## Motivation

While the Advanced Data Privacy RFC (#1645) provides a comprehensive solution for data privacy, there are cases where users need more flexibility to implement custom response rendering logic. This could include:

- Custom data transformation beyond simple obfuscation
- Complex conditional rendering based on multiple factors
- Integration with external systems for response processing
- Implementation of custom data privacy rules not covered by the standard solution

## Design

### 1. Extending graphql-go-tools Engine

The graphql-go-tools engine needs to be extended to support custom render functions. This will be done by adding a new interface in `resolvable.go`:

```go
type ValueContext struct {
    // Field information
    FieldName     string
    FieldType     string
    ParentType    string
    IsList        bool
    IsNullable    bool
    
    // Additional metadata
    Path          []string

    // The value to render
    Data []byte
}

type CustomValueRenderer interface {
    Render(ctx *core.RequestContext, value ValueContext, writer io.Writer) (int,error)
}
```

### 2. Router Hook System Extension

The Cosmo Router's hook system will be extended to support custom renderers. This will be done by adding a new interface to the existing module system:

```go
type ResponseRenderer interface {
    // RegisterValueRenderer registers a custom renderer for specific types/fields
    RegisterValueRenderer(renderer CustomValueRenderer) error
}
```

### 3. Configuration

Modules can be configured through the router's configuration file. The configuration follows the same pattern as other custom modules, using `mapstructure` tags for field mapping.

```go
type CustomRendererModule struct {
    // Properties that are set by the config file are automatically populated based on the `mapstructure` tag
    // Create a new section under `modules.<name>` in the config file with the same name as your module.
    // Don't forget in Go the first letter of a property must be uppercase to be exported
    Types []RendererType `mapstructure:"types"`
}

type RendererType struct {
    Name   string   `mapstructure:"name"`
    Fields []string `mapstructure:"fields"`
}

// Example config.yaml:
modules:
  customRenderer:
    types:
      - name: "User"
        fields:
          - "email"
          - "phone"
```

The configuration can be validated in the `Provisioner` interface:

```go
func (m *CustomRendererModule) Provision(ctx *core.ModuleContext) error {
    // Validate configuration
    for _, t := range m.Types {
        if t.Name == "" {
            return fmt.Errorf("type name cannot be empty")
        }
        if len(t.Fields) == 0 {
            return fmt.Errorf("type %s must have at least one field", t.Name)
        }
    }
    return nil
}
```

## Implementation Details

### 1. Engine Integration

The graphql-go-tools engine will be modified to:

1. Check for registered custom renderers before applying default rendering
2. Pass the RenderContext to custom renderers
3. Handle errors from custom renderers appropriately
4. Support chaining multiple renderers

### 2. Hook System Integration

The router's hook system will:

1. Initialize custom renderers during router startup
2. Provide a clean API for registering/unregistering renderers
3. Handle renderer lifecycle (startup/shutdown)
4. Provide proper error handling and logging

### 3. Performance Considerations

- Renderers should be registered at startup to avoid runtime overhead
- The engine should cache renderer lookups for frequently accessed fields
- Renderers should be designed to be stateless to support concurrent requests
- Heavy processing should be done asynchronously when possible

## Example Usage

```go
type CustomPrivacyRenderer struct {
    // Configuration
    config map[string]interface{}
}

func (r *CustomPrivacyRenderer) Render(ctx *core.RequestContext, value ValueContext, writer io.Writer) (int, error) {
    // Example: Obfuscate email addresses
    if value.ParentType == "User" && value.FieldName == "email" {
        email := string(value.Data)
        parts := strings.Split(email, "@")
        if len(parts) != 2 {
            return writer.Write(value.Data)
        }
        
        obfuscated := strings.Repeat("*", len(parts[0])) + "@" + parts[1]
        return writer.Write([]byte(obfuscated))
    }
    
    // For non-matching fields, write the original value
    return writer.Write(value.Data)
}

// Register the renderer
renderer := &CustomPrivacyRenderer{
    config: map[string]interface{}{
        "types": []string{"User"},
        "fields": []string{"email"},
    },
}
router.RegisterRenderer(renderer)
```

### Example Query and Response

Here's an example showing how the privacy renderer affects the response:

```graphql
# Query
query GetUser {
  user {
    id
    name
    email
    phone
  }
}
```

Without privacy renderer:
```json
{
  "data": {
    "user": {
      "id": "1",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "phone": "+1234567890"
    }
  }
}
```

With privacy renderer:
```json
{
  "data": {
    "user": {
      "id": "1",
      "name": "John Doe",
      "email": "****.doe@example.com",
      "phone": "+1234567890"
    }
  }
}
```

The privacy renderer only affects the `email` field while leaving other fields unchanged. The obfuscation preserves the domain part of the email address while masking the local part.

## Migration Path

1. The changes will be backward compatible - existing code will continue to work without modification
2. Users can gradually adopt custom renderers as needed
3. Documentation will be provided for migrating from the data privacy system to custom renderers

## Security Considerations

- Custom renderers should be thoroughly tested before deployment
- Renderers should not have access to sensitive router internals
- Rate limiting and resource constraints should be enforced
- Proper error handling and logging should be implemented

## Future Work

1. Add support for renderer composition and chaining
2. Implement renderer performance monitoring
3. Add support for dynamic renderer registration
4. Create a marketplace for community-contributed renderers

## Alternatives Considered

1. **Direct GraphQL Schema Modification**: Rejected as it would require schema changes and limit flexibility
2. **Middleware-based Approach**: Rejected as it would not provide fine-grained control over field rendering
3. **External Service Integration**: Rejected as it would introduce additional latency and complexity

## References

- [Advanced Data Privacy RFC](https://github.com/wundergraph/cosmo/pull/1645)
- [graphql-go-tools Engine](https://github.com/wundergraph/graphql-go-tools)
- [Cosmo Router Modules](https://github.com/wundergraph/cosmo/blob/main/router/core/modules.go)