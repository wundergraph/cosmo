package connectrpc

import (
	"fmt"
	"strings"

	"github.com/jhump/protoreflect/desc"
)

// SelectionGenerator generates GraphQL selection sets from proto message descriptors
type SelectionGenerator struct{}

// NewSelectionGenerator creates a new selection set generator
func NewSelectionGenerator() *SelectionGenerator {
	return &SelectionGenerator{}
}

// GenerateSelectionSet generates a GraphQL selection set from a proto message descriptor
// It walks the message structure recursively and includes all fields
func (g *SelectionGenerator) GenerateSelectionSet(msg *desc.MessageDescriptor) (string, error) {
	if msg == nil {
		return "", fmt.Errorf("message descriptor cannot be nil")
	}

	// Generate the selection set starting at depth 0
	return g.generateFieldsRecursive(msg, 0), nil
}

// generateFieldsRecursive recursively generates field selections for a message
func (g *SelectionGenerator) generateFieldsRecursive(msg *desc.MessageDescriptor, depth int) string {

	fields := msg.GetFields()
	if len(fields) == 0 {
		return ""
	}

	var selections []string
	indent := strings.Repeat("  ", depth)

	for _, field := range fields {
		fieldName := g.toGraphQLFieldName(field.GetName())

		// Handle different field types
		switch {
		case field.GetMessageType() != nil:
			// Nested message - recurse
			nestedMsg := field.GetMessageType()
			nestedSelection := g.generateFieldsRecursive(nestedMsg, depth+1)

			// Only include the field if it has nested selections
			if nestedSelection != "" {
				selections = append(selections, fmt.Sprintf("%s%s {\n%s%s}", indent, fieldName, nestedSelection, indent))
			}

		case field.GetEnumType() != nil:
			// Enum field - just include the field name
			selections = append(selections, fmt.Sprintf("%s%s", indent, fieldName))

		default:
			// Scalar field (string, int32, bool, etc.) - just include the field name
			selections = append(selections, fmt.Sprintf("%s%s", indent, fieldName))
		}
	}

	if len(selections) == 0 {
		return ""
	}

	return strings.Join(selections, "\n") + "\n"
}

// toGraphQLFieldName converts a proto field name (snake_case) to GraphQL field name (camelCase)
// Proto convention: employee_id, has_pets, current_mood
// GraphQL convention: employeeId, hasPets, currentMood
func (g *SelectionGenerator) toGraphQLFieldName(protoName string) string {
	// Split by underscore
	parts := strings.Split(protoName, "_")
	if len(parts) == 1 {
		// No underscores - return as is
		return protoName
	}

	// First part stays lowercase, rest are capitalized
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}

	return result
}