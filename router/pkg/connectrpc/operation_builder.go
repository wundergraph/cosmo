package connectrpc

import (
	"fmt"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/protobuf/types/descriptorpb"
)

// OperationBuilder constructs complete GraphQL operations from proto method definitions
type OperationBuilder struct {
	selectionGenerator *SelectionGenerator
}

// NewOperationBuilder creates a new operation builder
func NewOperationBuilder() *OperationBuilder {
	return &OperationBuilder{
		selectionGenerator: NewSelectionGenerator(),
	}
}

// BuildOperation constructs a complete GraphQL operation from a method definition
// It combines the operation type, name, variables, and selection set into a valid GraphQL operation
func (b *OperationBuilder) BuildOperation(method *MethodDefinition) (string, error) {
	if method == nil {
		return "", fmt.Errorf("method definition cannot be nil")
	}

	// Determine operation type and name from method name
	opType, opName, err := b.parseMethodName(method.Name)
	if err != nil {
		return "", fmt.Errorf("failed to parse method name: %w", err)
	}

	// Generate variable definitions from input message
	varDefs, err := b.buildVariableDefinitions(method.InputMessageDescriptor)
	if err != nil {
		return "", fmt.Errorf("failed to build variable definitions: %w", err)
	}

	// Generate selection set from output message
	selectionSet, err := b.selectionGenerator.GenerateSelectionSet(method.OutputMessageDescriptor)
	if err != nil {
		return "", fmt.Errorf("failed to generate selection set: %w", err)
	}

	// Assemble the complete operation
	operation := b.assembleOperation(opType, opName, varDefs, selectionSet)

	return operation, nil
}

// parseMethodName extracts the operation type and name from a method name
// Expected format: "QueryOperationName" or "MutationOperationName"
// Returns: operationType (query/mutation), operationName, error
func (b *OperationBuilder) parseMethodName(methodName string) (string, string, error) {
	if methodName == "" {
		return "", "", fmt.Errorf("method name cannot be empty")
	}

	// Check for Query prefix
	if strings.HasPrefix(methodName, "Query") {
		opName := strings.TrimPrefix(methodName, "Query")
		if opName == "" {
			return "", "", fmt.Errorf("invalid method name: %s (missing operation name after 'Query')", methodName)
		}
		return "query", opName, nil
	}

	// Check for Mutation prefix
	if strings.HasPrefix(methodName, "Mutation") {
		opName := strings.TrimPrefix(methodName, "Mutation")
		if opName == "" {
			return "", "", fmt.Errorf("invalid method name: %s (missing operation name after 'Mutation')", methodName)
		}
		return "mutation", opName, nil
	}

	return "", "", fmt.Errorf("invalid method name: %s (must start with 'Query' or 'Mutation')", methodName)
}

// buildVariableDefinitions generates GraphQL variable definitions from a proto message descriptor
// Returns a string like "($id: Int!, $name: String)" or empty string if no fields
func (b *OperationBuilder) buildVariableDefinitions(msg *desc.MessageDescriptor) (string, error) {
	if msg == nil {
		return "", nil
	}

	fields := msg.GetFields()
	if len(fields) == 0 {
		return "", nil
	}

	var varDefs []string
	for _, field := range fields {
		varName := b.toGraphQLFieldName(field.GetName())
		varType, err := b.protoTypeToGraphQLType(field)
		if err != nil {
			return "", fmt.Errorf("failed to convert type for field %s: %w", field.GetName(), err)
		}

		varDefs = append(varDefs, fmt.Sprintf("$%s: %s", varName, varType))
	}

	return "(" + strings.Join(varDefs, ", ") + ")", nil
}

// protoTypeToGraphQLType converts a proto field type to a GraphQL type string
func (b *OperationBuilder) protoTypeToGraphQLType(field *desc.FieldDescriptor) (string, error) {
	var baseType string

	// Handle message types (nested objects)
	if field.GetMessageType() != nil {
		// For nested messages, we need to use the GraphQL input type name
		// This is typically the message name without the package prefix
		msgName := field.GetMessageType().GetName()
		baseType = msgName
	} else if field.GetEnumType() != nil {
		// For enums, use the enum type name
		enumName := field.GetEnumType().GetName()
		baseType = enumName
	} else {
		// Handle scalar types using descriptorpb types
		switch field.GetType() {
		case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
			baseType = "Boolean"
		case descriptorpb.FieldDescriptorProto_TYPE_INT32,
			descriptorpb.FieldDescriptorProto_TYPE_SINT32,
			descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
			baseType = "Int"
		case descriptorpb.FieldDescriptorProto_TYPE_INT64,
			descriptorpb.FieldDescriptorProto_TYPE_SINT64,
			descriptorpb.FieldDescriptorProto_TYPE_SFIXED64,
			descriptorpb.FieldDescriptorProto_TYPE_UINT32,
			descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
			descriptorpb.FieldDescriptorProto_TYPE_UINT64,
			descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
			// GraphQL doesn't have a native 64-bit int, so we use String or a custom scalar
			// For now, we'll use Int and let the implementation handle the conversion
			baseType = "Int"
		case descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
			descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
			baseType = "Float"
		case descriptorpb.FieldDescriptorProto_TYPE_STRING:
			baseType = "String"
		case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
			baseType = "String" // Bytes are typically base64 encoded strings in GraphQL
		default:
			return "", fmt.Errorf("unsupported proto type: %v", field.GetType())
		}
	}

	// Handle repeated fields (arrays)
	if field.IsRepeated() {
		baseType = "[" + baseType + "]"
	}

	// In proto3, all fields are optional by default, but we'll mark them as required
	// for simplicity. In a real implementation, you might want to check field presence.
	baseType += "!"

	return baseType, nil
}

// toGraphQLFieldName converts a proto field name (snake_case) to GraphQL field name (camelCase)
func (b *OperationBuilder) toGraphQLFieldName(protoName string) string {
	// Reuse the same logic from SelectionGenerator
	parts := strings.Split(protoName, "_")
	if len(parts) == 1 {
		return protoName
	}

	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}

	return result
}

// assembleOperation combines all parts into a complete GraphQL operation
func (b *OperationBuilder) assembleOperation(opType, opName, varDefs, selectionSet string) string {
	var sb strings.Builder

	// Write operation type and name
	sb.WriteString(opType)
	sb.WriteString(" ")
	sb.WriteString(opName)

	// Add variable definitions if present
	if varDefs != "" {
		sb.WriteString(varDefs)
	}

	sb.WriteString(" {\n")

	// Add selection set
	sb.WriteString(selectionSet)

	sb.WriteString("}")

	return sb.String()
}