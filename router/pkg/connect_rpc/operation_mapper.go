package connect_rpc

import (
	"fmt"
	"strings"

	"go.uber.org/zap"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// truncateString truncates a string to maxLen characters with ellipsis
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// GraphQLOperation represents a reconstructed GraphQL operation from proto
type GraphQLOperation struct {
	Name          string
	OperationType string // "query", "mutation", or "subscription"
	Query         string
	Variables     map[string]string // variable name -> GraphQL type
}

// OperationMapper reconstructs GraphQL operations from proto service definitions
type OperationMapper struct {
	logger     *zap.Logger
	operations map[string]*GraphQLOperation
}

// NewOperationMapper creates a new operation mapper from proto service descriptors
func NewOperationMapper(services []protoreflect.ServiceDescriptor, logger *zap.Logger) (*OperationMapper, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	mapper := &OperationMapper{
		logger:     logger,
		operations: make(map[string]*GraphQLOperation),
	}

	// Reconstruct GraphQL operations from proto service methods
	for _, service := range services {
		if err := mapper.reconstructOperationsFromService(service); err != nil {
			return nil, fmt.Errorf("failed to reconstruct operations from service %s: %w", service.Name(), err)
		}
	}

	logger.Info("Reconstructed GraphQL operations from proto", zap.Int("count", len(mapper.operations)))

	return mapper, nil
}

// reconstructOperationsFromService reconstructs GraphQL operations from a proto service
func (m *OperationMapper) reconstructOperationsFromService(service protoreflect.ServiceDescriptor) error {
	methods := service.Methods()

	for i := 0; i < methods.Len(); i++ {
		method := methods.Get(i)
		operation, err := m.reconstructOperation(method)
		if err != nil {
			m.logger.Warn("Failed to reconstruct operation from method",
				zap.String("method", string(method.Name())),
				zap.Error(err))
			continue
		}

		m.operations[operation.Name] = operation
		m.logger.Info("Reconstructed GraphQL operation from proto method",
			zap.String("method", operation.Name),
			zap.String("type", operation.OperationType),
			zap.Int("variables", len(operation.Variables)),
			zap.String("query_preview", truncateString(operation.Query, 150)))
	}

	return nil
}

// reconstructOperation reconstructs a GraphQL operation from a proto method descriptor
func (m *OperationMapper) reconstructOperation(method protoreflect.MethodDescriptor) (*GraphQLOperation, error) {
	operationName := string(method.Name())

	// Determine operation type based on method characteristics
	// - Streaming response = subscription
	// - Method name conventions or idempotency hints could indicate query vs mutation
	// For now, we'll use a simple heuristic: streaming = subscription, otherwise query
	operationType := "query"
	if method.IsStreamingServer() {
		operationType = "subscription"
	}
	// TODO: Add logic to detect mutations (e.g., based on method name patterns or options)

	// Extract variables from request message
	requestMsg := method.Input()
	variables := m.extractVariablesFromMessage(requestMsg)

	// Reconstruct the GraphQL query structure from response message
	responseMsg := method.Output()
	selectionSet := m.reconstructSelectionSet(responseMsg, 1)

	// Build the GraphQL operation string
	query := m.buildGraphQLQuery(operationName, operationType, variables, selectionSet)

	return &GraphQLOperation{
		Name:          operationName,
		OperationType: operationType,
		Query:         query,
		Variables:     variables,
	}, nil
}

// extractVariablesFromMessage extracts variable definitions from a proto request message
func (m *OperationMapper) extractVariablesFromMessage(msg protoreflect.MessageDescriptor) map[string]string {
	variables := make(map[string]string)

	fields := msg.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		protoFieldName := string(field.Name())
		// Convert proto field name (snake_case) to GraphQL variable name (camelCase)
		graphqlVarName := m.protoFieldToGraphQLField(protoFieldName)
		graphqlType := m.protoTypeToGraphQLType(field)
		variables[graphqlVarName] = graphqlType
	}

	return variables
}

// protoTypeToGraphQLType converts a proto field type to GraphQL type notation
func (m *OperationMapper) protoTypeToGraphQLType(field protoreflect.FieldDescriptor) string {
	var graphqlType string

	// Handle repeated fields (arrays)
	if field.Cardinality() == protoreflect.Repeated {
		innerType := m.getBaseGraphQLType(field)
		graphqlType = fmt.Sprintf("[%s]", innerType)
	} else {
		graphqlType = m.getBaseGraphQLType(field)
	}

	// Proto3 doesn't have required fields in the same way, but we can check for wrapper types
	// Wrapper types (google.protobuf.*Value) indicate nullable fields
	if !m.isWrapperType(field) && field.Cardinality() != protoreflect.Repeated {
		// Non-wrapper, non-repeated fields are typically non-null in GraphQL
		graphqlType = graphqlType + "!"
	}

	return graphqlType
}

// getBaseGraphQLType gets the base GraphQL type for a proto field
func (m *OperationMapper) getBaseGraphQLType(field protoreflect.FieldDescriptor) string {
	switch field.Kind() {
	case protoreflect.StringKind:
		return "String"
	case protoreflect.Int32Kind, protoreflect.Int64Kind, protoreflect.Sint32Kind, protoreflect.Sint64Kind,
		protoreflect.Uint32Kind, protoreflect.Uint64Kind, protoreflect.Sfixed32Kind, protoreflect.Sfixed64Kind,
		protoreflect.Fixed32Kind, protoreflect.Fixed64Kind:
		return "Int"
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return "Float"
	case protoreflect.BoolKind:
		return "Boolean"
	case protoreflect.MessageKind:
		// For message types, use the message name
		msgType := field.Message()
		if msgType != nil {
			return string(msgType.Name())
		}
		return "Unknown"
	case protoreflect.EnumKind:
		enumType := field.Enum()
		if enumType != nil {
			return string(enumType.Name())
		}
		return "Unknown"
	default:
		return "String" // Default fallback
	}
}

// isWrapperType checks if a field uses a Google wrapper type (indicating nullability)
func (m *OperationMapper) isWrapperType(field protoreflect.FieldDescriptor) bool {
	if field.Kind() != protoreflect.MessageKind {
		return false
	}

	msgType := field.Message()
	if msgType == nil {
		return false
	}

	fullName := string(msgType.FullName())
	return strings.HasPrefix(fullName, "google.protobuf.") &&
		(strings.HasSuffix(fullName, "Value") || fullName == "google.protobuf.Empty")
}

// reconstructSelectionSet reconstructs a GraphQL selection set from a proto message
func (m *OperationMapper) reconstructSelectionSet(msg protoreflect.MessageDescriptor, indent int) string {
	if msg == nil {
		return ""
	}

	var selections []string
	indentStr := strings.Repeat("  ", indent)

	fields := msg.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		fieldName := m.protoFieldToGraphQLField(string(field.Name()))

		// Check if this field has a nested message (selection set)
		if field.Kind() == protoreflect.MessageKind && !m.isWrapperType(field) {
			nestedMsg := field.Message()
			if nestedMsg != nil && nestedMsg.Fields().Len() > 0 {
				// This field has nested fields, so it needs a selection set
				nestedSelection := m.reconstructSelectionSet(nestedMsg, indent+1)
				selections = append(selections, fmt.Sprintf("%s%s %s", indentStr, fieldName, nestedSelection))
			} else {
				// Leaf field
				selections = append(selections, fmt.Sprintf("%s%s", indentStr, fieldName))
			}
		} else {
			// Scalar or enum field
			selections = append(selections, fmt.Sprintf("%s%s", indentStr, fieldName))
		}
	}

	if len(selections) == 0 {
		return "{}"
	}

	return fmt.Sprintf("{\n%s\n%s}", strings.Join(selections, "\n"), strings.Repeat("  ", indent-1))
}

// protoFieldToGraphQLField converts proto field naming (snake_case) to GraphQL (camelCase)
func (m *OperationMapper) protoFieldToGraphQLField(protoField string) string {
	// Convert snake_case to camelCase
	parts := strings.Split(protoField, "_")
	if len(parts) == 1 {
		return protoField
	}

	result := parts[0]
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			result += strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return result
}

// buildGraphQLQuery builds a complete GraphQL query string
func (m *OperationMapper) buildGraphQLQuery(name, operationType string, variables map[string]string, selectionSet string) string {
	var query strings.Builder

	// Operation definition
	query.WriteString(operationType)
	query.WriteString(" ")
	query.WriteString(name)

	// Variables
	if len(variables) > 0 {
		query.WriteString("(")
		first := true
		for varName, varType := range variables {
			if !first {
				query.WriteString(", ")
			}
			query.WriteString("$")
			query.WriteString(varName)
			query.WriteString(": ")
			query.WriteString(varType)
			first = false
		}
		query.WriteString(")")
	}

	// Selection set
	query.WriteString(" ")
	query.WriteString(selectionSet)

	return query.String()
}

// GetOperation retrieves a reconstructed GraphQL operation by name
func (m *OperationMapper) GetOperation(name string) (*GraphQLOperation, error) {
	operation, ok := m.operations[name]
	if !ok {
		return nil, fmt.Errorf("operation not found: %s", name)
	}
	return operation, nil
}

// GetAllOperations returns all reconstructed operations
func (m *OperationMapper) GetAllOperations() map[string]*GraphQLOperation {
	return m.operations
}

// HasOperation checks if an operation exists
func (m *OperationMapper) HasOperation(name string) bool {
	_, ok := m.operations[name]
	return ok
}

// ListOperationNames returns a list of all operation names
func (m *OperationMapper) ListOperationNames() []string {
	names := make([]string, 0, len(m.operations))
	for name := range m.operations {
		names = append(names, name)
	}
	return names
}
