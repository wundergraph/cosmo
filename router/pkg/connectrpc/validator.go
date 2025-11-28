package connectrpc

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/protobuf/types/descriptorpb"
)

// MessageValidator validates JSON messages against proto message descriptors
type MessageValidator struct {
	protoLoader *ProtoLoader
}

// NewMessageValidator creates a new message validator
func NewMessageValidator(protoLoader *ProtoLoader) *MessageValidator {
	return &MessageValidator{
		protoLoader: protoLoader,
	}
}

// ValidationError represents a validation error with details
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("field '%s': %s", e.Field, e.Message)
	}
	return e.Message
}

// ValidateMessage validates a JSON message against a proto message descriptor
func (v *MessageValidator) ValidateMessage(serviceName, methodName string, messageJSON []byte) error {
	// Get the method definition
	method, err := v.protoLoader.GetMethod(serviceName, methodName)
	if err != nil {
		return fmt.Errorf("failed to get method: %w", err)
	}

	// Parse the JSON message
	var data map[string]interface{}
	if err := json.Unmarshal(messageJSON, &data); err != nil {
		return &ValidationError{
			Message: fmt.Sprintf("invalid JSON: %s", err.Error()),
		}
	}

	// DEBUG: Log what we're validating
	fmt.Printf("DEBUG: Validating message for %s.%s\n", serviceName, methodName)
	fmt.Printf("DEBUG: Input message type: %s\n", method.InputMessageDescriptor.GetFullyQualifiedName())
	fmt.Printf("DEBUG: JSON data keys: %v\n", getKeys(data))
	fmt.Printf("DEBUG: Proto fields: %v\n", getFieldNames(method.InputMessageDescriptor))

	// Validate against the input message descriptor
	return v.validateMessageFields(method.InputMessageDescriptor, data, "")
}

func getKeys(data map[string]interface{}) []string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	return keys
}

func getFieldNames(msgDesc *desc.MessageDescriptor) []string {
	fields := msgDesc.GetFields()
	names := make([]string, len(fields))
	for i, field := range fields {
		names[i] = field.GetName()
	}
	return names
}

// validateMessageFields recursively validates message fields
func (v *MessageValidator) validateMessageFields(msgDesc *desc.MessageDescriptor, data map[string]interface{}, fieldPath string) error {
	fields := msgDesc.GetFields()

	// Check each field in the message
	for _, field := range fields {
		fieldName := field.GetName()
		fullPath := fieldPath
		if fullPath != "" {
			fullPath += "."
		}
		fullPath += fieldName

		value, exists := data[fieldName]

		// Check required fields (proto2 only, proto3 doesn't have required)
		if field.IsRequired() && !exists {
			return &ValidationError{
				Field:   fullPath,
				Message: "required field is missing",
			}
		}

		// Skip validation if field is not present (optional fields)
		if !exists {
			continue
		}

		// Validate the field value
		if err := v.validateFieldValue(field, value, fullPath); err != nil {
			return err
		}
	}

	return nil
}

// validateFieldValue validates a single field value against its descriptor
func (v *MessageValidator) validateFieldValue(field *desc.FieldDescriptor, value interface{}, fieldPath string) error {
	// Handle null values
	if value == nil {
		// Null is only valid for optional fields
		if field.IsRequired() {
			return &ValidationError{
				Field:   fieldPath,
				Message: "required field cannot be null",
			}
		}
		return nil
	}

	// Handle repeated fields (arrays)
	if field.IsRepeated() {
		arr, ok := value.([]interface{})
		if !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("expected array, got %T", value),
			}
		}

		// Validate each element in the array
		for i, elem := range arr {
			elemPath := fmt.Sprintf("%s[%d]", fieldPath, i)
			if err := v.validateScalarOrMessageValue(field, elem, elemPath); err != nil {
				return err
			}
		}
		return nil
	}

	// Handle singular fields
	return v.validateScalarOrMessageValue(field, value, fieldPath)
}

// validateScalarOrMessageValue validates either a scalar or message value
func (v *MessageValidator) validateScalarOrMessageValue(field *desc.FieldDescriptor, value interface{}, fieldPath string) error {
	// Handle message types (nested messages)
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		nestedData, ok := value.(map[string]interface{})
		if !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("expected object, got %T", value),
			}
		}
		return v.validateMessageFields(field.GetMessageType(), nestedData, fieldPath)
	}

	// Handle scalar types
	return v.validateScalarValue(field, value, fieldPath)
}

// validateScalarValue validates a scalar field value
func (v *MessageValidator) validateScalarValue(field *desc.FieldDescriptor, value interface{}, fieldPath string) error {
	fieldType := field.GetType()
	typeName := strings.ToLower(field.GetType().String())

	switch fieldType {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		if _, ok := value.(float64); !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("%s cannot represent non-numeric value: %v", typeName, value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		// JSON numbers are float64, check if it's a valid integer
		if num, ok := value.(float64); ok {
			if num != float64(int32(num)) {
				return &ValidationError{
					Field:   fieldPath,
					Message: fmt.Sprintf("Int32 cannot represent non-integer value: %v", value),
				}
			}
		} else if _, ok := value.(string); ok {
			// String values are not valid for integer fields
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Int32 cannot represent non-integer value: %v", value),
			}
		} else {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Int32 cannot represent non-numeric value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// JSON numbers are float64, check if it's a valid integer
		// Note: int64 can be represented as string in JSON to avoid precision loss
		switch v := value.(type) {
		case float64:
			if v != float64(int64(v)) {
				return &ValidationError{
					Field:   fieldPath,
					Message: fmt.Sprintf("Int64 cannot represent non-integer value: %v", value),
				}
			}
		case string:
			// String representation is valid for int64
		default:
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Int64 cannot represent non-numeric value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		if num, ok := value.(float64); ok {
			if num < 0 || num != float64(uint32(num)) {
				return &ValidationError{
					Field:   fieldPath,
					Message: fmt.Sprintf("UInt32 cannot represent value: %v", value),
				}
			}
		} else {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("UInt32 cannot represent non-numeric value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		switch v := value.(type) {
		case float64:
			if v < 0 || v != float64(uint64(v)) {
				return &ValidationError{
					Field:   fieldPath,
					Message: fmt.Sprintf("UInt64 cannot represent value: %v", value),
				}
			}
		case string:
			// String representation is valid for uint64
		default:
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("UInt64 cannot represent non-numeric value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		if _, ok := value.(bool); !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Boolean cannot represent non-boolean value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		if _, ok := value.(string); !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("String cannot represent non-string value: %v", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		// Bytes are typically base64 encoded strings in JSON
		if _, ok := value.(string); !ok {
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Bytes must be base64 encoded string, got: %T", value),
			}
		}

	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		// Enums can be either string (name) or number (value)
		switch value.(type) {
		case string, float64:
			// Valid enum representation
		default:
			return &ValidationError{
				Field:   fieldPath,
				Message: fmt.Sprintf("Enum must be string or number, got: %T", value),
			}
		}
	}

	return nil
}