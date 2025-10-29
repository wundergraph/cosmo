package connect_rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"buf.build/go/hyperpb"
	"connectrpc.com/connect"
	"connectrpc.com/vanguard"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// BackendCodec specifies which codec the backend handler uses
type BackendCodec string

const (
	BackendCodecProto BackendCodec = "proto"
	BackendCodecJSON  BackendCodec = "json"
)

// SetupVanguardWithDynamicProto creates a Vanguard transcoder with dynamic proto support.
// It extracts all services from the FileDescriptorSet and creates handlers for each.
// backendCodec specifies whether your backend handler speaks "proto" or "json"
// graphqlEndpoint is the URL of the GraphQL server to proxy requests to
func SetupVanguardWithDynamicProto(fds *descriptorpb.FileDescriptorSet, backendCodec BackendCodec, graphqlEndpoint string) (http.Handler, error) {
	// Create handler with compiled message types
	handler, err := NewHandler(fds, graphqlEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to create handler: %w", err)
	}

	// Create a Files registry for type resolution
	files, err := protodesc.NewFiles(fds)
	if err != nil {
		return nil, fmt.Errorf("failed to create files registry: %w", err)
	}

	// Register all files in the global registry for Vanguard to use
	// Vanguard uses protoregistry.GlobalFiles by default
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		_, err := protoregistry.GlobalFiles.FindFileByPath(fd.Path())
		if err != nil {
			// File not registered, register it
			if regErr := protoregistry.GlobalFiles.RegisterFile(fd); regErr != nil {
				// Silently ignore errors - files may already be registered
				// This is expected for well-known types like google/protobuf/*
				log.Printf("Debug: file %s registration: %v", fd.Path(), regErr)
			}
		}
		return true
	})

	// Extract all services from the FileDescriptorSet
	services, err := extractServices(fds)
	if err != nil {
		return nil, fmt.Errorf("failed to extract services: %w", err)
	}

	// Create Vanguard services for each proto service
	// Vanguard will use protoregistry.GlobalFiles for type resolution
	vanguardServices := make([]*vanguard.Service, 0, len(services))
	for _, serviceName := range services {
		var connectHandler http.Handler
		var targetCodec string

		// Choose handler and codec based on backend preference
		switch backendCodec {
		case BackendCodecJSON:
			// Backend speaks JSON - Vanguard will transcode Proto->JSON
			connectHandler = handler.createJSONHandler(serviceName)
			targetCodec = vanguard.CodecJSON
			log.Printf("Service %s configured with JSON backend", serviceName)
		default:
			return nil, fmt.Errorf("unsupported backend codec: %s (only JSON is supported)", backendCodec)
		}

		vanguardService := vanguard.NewService(
			serviceName,
			connectHandler,
			vanguard.WithTargetCodecs(targetCodec),
		)
		vanguardServices = append(vanguardServices, vanguardService)
	}

	// Create transcoder
	return vanguard.NewTranscoder(vanguardServices)
}

// Handler implements http.Handler for dynamic proto message processing.
type Handler struct {
	fds              *descriptorpb.FileDescriptorSet
	messageTypes     map[string]*MessageTypeInfo
	services         map[string]protoreflect.ServiceDescriptor
	graphqlEndpoint  string
	httpClient       *http.Client
}

// GraphQLRequest represents a GraphQL request
type GraphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables,omitempty"`
}

// GraphQLResponse represents a GraphQL response
type GraphQLResponse struct {
	Data   json.RawMessage   `json:"data"`
	Errors []GraphQLError    `json:"errors,omitempty"`
}

// GraphQLError represents a GraphQL error
type GraphQLError struct {
	Message string        `json:"message"`
	Path    []interface{} `json:"path,omitempty"`
}

// MessageTypeInfo holds compiled message type information for a method.
type MessageTypeInfo struct {
	RequestType  *hyperpb.MessageType
	ResponseType *hyperpb.MessageType
	Method       protoreflect.MethodDescriptor
}

// NewHandler creates a new Handler with compiled message types from the FileDescriptorSet.
func NewHandler(fds *descriptorpb.FileDescriptorSet, graphqlEndpoint string) (*Handler, error) {
	if fds == nil {
		return nil, fmt.Errorf("FileDescriptorSet cannot be nil")
	}

	if graphqlEndpoint == "" {
		return nil, fmt.Errorf("graphqlEndpoint cannot be empty")
	}

	// Create HTTP client with retries
	retryClient := retryablehttp.NewClient()
	retryClient.Logger = nil
	httpClient := retryClient.StandardClient()
	httpClient.Timeout = 60 * time.Second

	handler := &Handler{
		fds:             fds,
		messageTypes:    make(map[string]*MessageTypeInfo),
		services:        make(map[string]protoreflect.ServiceDescriptor),
		graphqlEndpoint: graphqlEndpoint,
		httpClient:      httpClient,
	}

	// Compile message types for all services and methods
	if err := handler.compileMessageTypes(); err != nil {
		return nil, fmt.Errorf("failed to compile message types: %w", err)
	}

	return handler, nil
}

// compileMessageTypes compiles all message types from the file descriptors.
func (h *Handler) compileMessageTypes() error {
	// Create a Files registry for resolving dependencies
	files, err := protodesc.NewFiles(h.fds)
	if err != nil {
		return fmt.Errorf("failed to create files registry: %w", err)
	}

	// Iterate through all files in the FileDescriptorSet
	for i := 0; i < len(h.fds.GetFile()); i++ {
		fileDescProto := h.fds.GetFile()[i]

		// Get the file descriptor from the registry by name
		fd, err := files.FindFileByPath(fileDescProto.GetName())
		if err != nil {
			return fmt.Errorf("failed to find file descriptor for %s: %w", fileDescProto.GetName(), err)
		}

		// Iterate through services
		services := fd.Services()
		for j := 0; j < services.Len(); j++ {
			service := services.Get(j)
			serviceName := string(service.FullName())
			h.services[serviceName] = service

			// Iterate through methods
			methods := service.Methods()
			for k := 0; k < methods.Len(); k++ {
				method := methods.Get(k)
				methodFullName := fmt.Sprintf("%s/%s", serviceName, method.Name())

				// Compile request message type
				requestType, err := hyperpb.CompileFileDescriptorSet(
					h.fds,
					method.Input().FullName(),
				)
				if err != nil {
					return fmt.Errorf("failed to compile request type for %s: %w", methodFullName, err)
				}

				// Compile response message type
				responseType, err := hyperpb.CompileFileDescriptorSet(
					h.fds,
					method.Output().FullName(),
				)
				if err != nil {
					return fmt.Errorf("failed to compile response type for %s: %w", methodFullName, err)
				}

				h.messageTypes[methodFullName] = &MessageTypeInfo{
					RequestType:  requestType,
					ResponseType: responseType,
					Method:       method,
				}

				log.Printf("Compiled message types for method: %s", methodFullName)
			}
		}
	}

	return nil
}


// createJSONHandler creates a handler that ONLY accepts JSON
// This forces Vanguard to transcode protobuf requests to JSON
func (h *Handler) createJSONHandler(serviceName string) http.Handler {
	mux := http.NewServeMux()

	// Get the service descriptor
	serviceDesc, ok := h.services[serviceName]
	if !ok {
		log.Printf("Warning: service %s not found in handler", serviceName)
		return mux
	}

	// Register each method in the service
	methods := serviceDesc.Methods()
	for i := 0; i < methods.Len(); i++ {
		method := methods.Get(i)
		methodFullName := fmt.Sprintf("%s/%s", serviceName, method.Name())

		// Get the message type info
		typeInfo, ok := h.messageTypes[methodFullName]
		if !ok {
			log.Printf("Warning: method %s not found in message types", methodFullName)
			continue
		}

		// Create the handler path: /ServiceName/MethodName
		handlerPath := fmt.Sprintf("/%s/%s", serviceName, method.Name())

		// Capture typeInfo in closure properly
		currentTypeInfo := typeInfo

		// Register the handler for this method
		mux.HandleFunc(handlerPath, func(w http.ResponseWriter, r *http.Request) {
			h.handleJSONMethod(w, r, currentTypeInfo)
		})

		log.Printf("Registered JSON handler for: %s", handlerPath)
	}

	return mux
}


// handleJSONMethod handles a single RPC method call with JSON ONLY
// This REJECTS non-JSON requests, forcing Vanguard to transcode
func (h *Handler) handleJSONMethod(w http.ResponseWriter, r *http.Request, typeInfo *MessageTypeInfo) {
	contentType := r.Header.Get("Content-Type")

	log.Printf("Handling method: %s", typeInfo.Method.FullName())
	log.Printf("Content-Type: %s", contentType)

	// REJECT non-JSON content types
	// This forces Vanguard to transcode protobuf to JSON
	if contentType != "application/json" && !strings.HasPrefix(contentType, "application/json") {
		log.Printf("REJECTING non-JSON request with Content-Type: %s", contentType)
		h.writeError(w, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("this handler only accepts JSON, got: %s", contentType)))
		return
	}

	// Read request body (should be JSON after Vanguard transcoding)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read request body: %w", err)))
		return
	}
	defer r.Body.Close()

	log.Printf("Body length: %d bytes", len(body))
	log.Printf("JSON body: %s", string(body))

	// Parse JSON request to extract variables
	var jsonRequest map[string]interface{}
	if err := json.Unmarshal(body, &jsonRequest); err != nil {
		log.Printf("Failed to parse JSON request: %v", err)
		h.writeError(w, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("failed to parse JSON request: %w", err)))
		return
	}

	log.Printf("Successfully parsed JSON request!")

	// Convert JSON request to GraphQL query
	graphqlQuery, variables, err := h.jsonToGraphQL(typeInfo, jsonRequest)
	if err != nil {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to convert to GraphQL: %w", err)))
		return
	}

	log.Printf("Generated GraphQL query: %s", graphqlQuery)
	log.Printf("Variables: %v", variables)

	// Execute GraphQL query
	responseData, err := h.executeGraphQL(r.Context(), graphqlQuery, variables)
	if err != nil {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to execute GraphQL query: %w", err)))
		return
	}

	// Parse GraphQL response to extract the data field
	var gqlResponse map[string]json.RawMessage
	if err := json.Unmarshal(responseData, &gqlResponse); err != nil {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse GraphQL response: %w", err)))
		return
	}

	// Get the wrapper field name from the response type
	responseFields := typeInfo.ResponseType.Descriptor().Fields()
	if responseFields.Len() == 0 {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("response type has no fields")))
		return
	}

	wrapperField := responseFields.Get(0)
	wrapperFieldName := string(wrapperField.Name())

	// Wrap the GraphQL response in the proto structure
	wrappedResponse := map[string]json.RawMessage{
		wrapperFieldName: gqlResponse[wrapperFieldName],
	}

	// Marshal the wrapped response
	data, err := json.Marshal(wrappedResponse)
	if err != nil {
		h.writeError(w, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to marshal response: %w", err)))
		return
	}

	log.Printf("Returning JSON response: %s", string(data))

	// Write response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("Failed to write response: %v", err)
	}
}

// jsonToGraphQL converts a JSON request to a GraphQL query using AST
func (h *Handler) jsonToGraphQL(typeInfo *MessageTypeInfo, jsonRequest map[string]interface{}) (string, map[string]interface{}, error) {
	// Get method name for the query
	methodName := string(typeInfo.Method.Name())
	
	log.Printf("Generating GraphQL query for method: %s", methodName)
	
	// Get the request message descriptor to determine field types
	requestDesc := typeInfo.RequestType.Descriptor()
	fields := requestDesc.Fields()
	
	// Convert variables to camelCase for GraphQL and ensure correct types
	variables := make(map[string]interface{})
	
	// Create AST document with proper initialization
	doc := ast.NewSmallDocument()
	
	// Create operation definition first
	operationNameRef := doc.Input.AppendInputString(methodName)
	
	// Build selection set from proto response type
	selectionSetNode := h.buildSelectionSetFromProto(doc, typeInfo)
	
	// Determine operation type from method name prefix (set by protographic)
	operationType := h.determineOperationType(methodName)
	
	// Create the operation definition
	opDef := ast.OperationDefinition{
		OperationType:          operationType,
		Name:                   operationNameRef,
		HasVariableDefinitions: len(jsonRequest) > 0,
		VariableDefinitions:    ast.VariableDefinitionList{Refs: []int{}},
		SelectionSet:           selectionSetNode,
		HasSelections:          true,
	}
	
	// Add operation to document and root nodes
	doc.OperationDefinitions = append(doc.OperationDefinitions, opDef)
	opDefRef := len(doc.OperationDefinitions) - 1
	
	// Add operation to root nodes so the printer can find it
	doc.AddRootNode(ast.Node{
		Kind: ast.NodeKindOperationDefinition,
		Ref:  opDefRef,
	})
	
	log.Printf("Added operation definition at index %d", opDefRef)
	
	// Add variable definitions
	for key, value := range jsonRequest {
		// Find the proto field descriptor
		field := fields.ByName(protoreflect.Name(key))
		if field == nil {
			log.Printf("Warning: field '%s' not found in proto, skipping", key)
			continue
		}
		
		// Convert snake_case to camelCase for GraphQL
		graphqlVarName := h.protoFieldToGraphQLVar(key)
		
		// Convert value to match the proto field type
		convertedValue, err := h.convertValueToProtoType(value, field)
		if err != nil {
			log.Printf("Warning: failed to convert value for field '%s': %v", key, err)
			convertedValue = value // Use original value as fallback
		}
		
		// Store variable with camelCase key and converted value
		variables[graphqlVarName] = convertedValue
		
		// Add variable value to document
		varNameRef := doc.Input.AppendInputString(graphqlVarName)
		varValueRef := doc.AddVariableValue(ast.VariableValue{
			Name: varNameRef,
		})
		
		// Determine GraphQL type from proto field descriptor
		graphqlType := h.protoFieldKindToGraphQLTypeString(field)
		typeRef := doc.AddNamedType([]byte(graphqlType))
		typeRef = doc.AddNonNullType(typeRef)
		
		// Add variable definition to operation
		doc.AddVariableDefinitionToOperationDefinition(opDefRef, varValueRef, typeRef)
		
		log.Printf("Variable: %s (%s) = %v (type: %T)", graphqlVarName, graphqlType, convertedValue, convertedValue)
	}
	
	// Print the AST to string
	query, err := astprinter.PrintString(doc)
	if err != nil {
		return "", nil, fmt.Errorf("failed to print GraphQL query: %w", err)
	}
	
	log.Printf("Generated GraphQL query:\n%s", query)
	log.Printf("With variables: %v", variables)
	
	return query, variables, nil
}

// buildSelectionSetFromProto builds a GraphQL selection set from proto message descriptor
func (h *Handler) buildSelectionSetFromProto(doc *ast.Document, typeInfo *MessageTypeInfo) int {
	// Get the wrapper field name from response type
	responseFields := typeInfo.ResponseType.Descriptor().Fields()
	if responseFields.Len() == 0 {
		return ast.InvalidRef
	}
	
	wrapperField := responseFields.Get(0)
	graphqlFieldName := h.methodNameToGraphQLField(string(typeInfo.Method.Name()), typeInfo.ResponseType.Descriptor())
	
	// Create field for the query (e.g., "employee")
	fieldNameRef := doc.Input.AppendInputString(graphqlFieldName)
	
	// Build arguments from variables
	var argumentRefs []int
	requestDesc := typeInfo.RequestType.Descriptor()
	requestFields := requestDesc.Fields()
	
	for i := 0; i < requestFields.Len(); i++ {
		field := requestFields.Get(i)
		protoFieldName := string(field.Name())
		graphqlVarName := h.protoFieldToGraphQLVar(protoFieldName)
		argName := h.graphqlVarToArgName(graphqlVarName)
		
		argNameRef := doc.Input.AppendInputString(argName)
		varNameRef := doc.Input.AppendInputString(graphqlVarName)
		
		argRef := doc.AddArgument(ast.Argument{
			Name: argNameRef,
			Value: ast.Value{
				Kind: ast.ValueKindVariable,
				Ref:  doc.AddVariableValue(ast.VariableValue{Name: varNameRef}),
			},
		})
		argumentRefs = append(argumentRefs, argRef)
	}
	
	// Build nested selection set from the inner message type
	var nestedSelectionSet int
	if wrapperField.Kind() == protoreflect.MessageKind {
		innerMsgDesc := wrapperField.Message()
		nestedSelectionSet = h.buildFieldSelectionSet(doc, innerMsgDesc, 0)
	}
	
	// Create the field
	fieldNode := doc.AddField(ast.Field{
		Name:          fieldNameRef,
		HasArguments:  len(argumentRefs) > 0,
		Arguments:     ast.ArgumentList{Refs: argumentRefs},
		SelectionSet:  nestedSelectionSet,
		HasSelections: nestedSelectionSet != ast.InvalidRef,
	})
	
	// Add field as a selection
	selectionRef := doc.AddSelectionToDocument(ast.Selection{
		Kind: ast.SelectionKindField,
		Ref:  fieldNode.Ref,
	})
	
	// Create selection set with this field
	return doc.AddSelectionSetToDocument(ast.SelectionSet{
		SelectionRefs: []int{selectionRef},
	})
}

// buildFieldSelectionSet recursively builds selection set from proto message
func (h *Handler) buildFieldSelectionSet(doc *ast.Document, msgDesc protoreflect.MessageDescriptor, depth int) int {
	if depth > 10 {
		return ast.InvalidRef
	}
	
	fields := msgDesc.Fields()
	if fields.Len() == 0 {
		return ast.InvalidRef
	}
	
	// Build selection refs first
	var selectionRefs []int
	
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		fieldName := string(field.Name())
		fieldNameRef := doc.Input.AppendInputString(fieldName)
		
		var nestedSelectionSet int
		var hasSelections bool
		if field.Kind() == protoreflect.MessageKind {
			nestedMsg := field.Message()
			nestedSelectionSet = h.buildFieldSelectionSet(doc, nestedMsg, depth+1)
			hasSelections = nestedSelectionSet != ast.InvalidRef
		}
		
		fieldNode := doc.AddField(ast.Field{
			Name:          fieldNameRef,
			SelectionSet:  nestedSelectionSet,
			HasSelections: hasSelections,
		})
		
		// Add field as a selection
		selectionRef := doc.AddSelectionToDocument(ast.Selection{
			Kind: ast.SelectionKindField,
			Ref:  fieldNode.Ref,
		})
		selectionRefs = append(selectionRefs, selectionRef)
	}
	
	// Create selection set with all selections
	return doc.AddSelectionSetToDocument(ast.SelectionSet{
		SelectionRefs: selectionRefs,
	})
}

// protoFieldKindToGraphQLTypeString returns the GraphQL type name as string
func (h *Handler) protoFieldKindToGraphQLTypeString(field protoreflect.FieldDescriptor) string {
	switch field.Kind() {
	case protoreflect.BoolKind:
		return "Boolean"
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind,
		protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind,
		protoreflect.Uint32Kind, protoreflect.Fixed32Kind,
		protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return "Int"
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return "Float"
	case protoreflect.StringKind, protoreflect.BytesKind:
		return "String"
	default:
		return "String"
	}
}

// convertValueToProtoType converts a JSON value to match the proto field type
func (h *Handler) convertValueToProtoType(value interface{}, field protoreflect.FieldDescriptor) (interface{}, error) {
	switch field.Kind() {
	case protoreflect.BoolKind:
		if b, ok := value.(bool); ok {
			return b, nil
		}
		if s, ok := value.(string); ok {
			return s == "true" || s == "1", nil
		}
		
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind,
		protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind,
		protoreflect.Uint32Kind, protoreflect.Fixed32Kind,
		protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		// Handle string to int conversion
		if s, ok := value.(string); ok {
			var i int64
			if _, err := fmt.Sscanf(s, "%d", &i); err == nil {
				return int(i), nil
			}
			return nil, fmt.Errorf("cannot convert string %q to int", s)
		}
		// Handle float64 (from JSON) to int
		if f, ok := value.(float64); ok {
			return int(f), nil
		}
		// Already an int
		if i, ok := value.(int); ok {
			return i, nil
		}
		
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		if f, ok := value.(float64); ok {
			return f, nil
		}
		if s, ok := value.(string); ok {
			var f float64
			if _, err := fmt.Sscanf(s, "%f", &f); err == nil {
				return f, nil
			}
		}
		
	case protoreflect.StringKind:
		if s, ok := value.(string); ok {
			return s, nil
		}
		// Convert other types to string
		return fmt.Sprintf("%v", value), nil
		
	case protoreflect.BytesKind:
		if s, ok := value.(string); ok {
			return s, nil
		}
	}
	
	// Return original value if no conversion needed
	return value, nil
}

// protoFieldToGraphQLType converts a proto field descriptor to GraphQL type
func (h *Handler) protoFieldToGraphQLType(field protoreflect.FieldDescriptor) string {
	switch field.Kind() {
	case protoreflect.BoolKind:
		return "Boolean!"
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		return "Int!"
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return "Int!"
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return "Int!"
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return "Int!"
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return "Float!"
	case protoreflect.StringKind:
		return "String!"
	case protoreflect.BytesKind:
		return "String!"
	default:
		return "String!"
	}
}


// protoFieldToGraphQLVar converts proto field name to GraphQL variable name
// e.g., employee_id -> employeeId
func (h *Handler) protoFieldToGraphQLVar(protoField string) string {
	parts := strings.Split(protoField, "_")
	if len(parts) == 0 {
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

// graphqlVarToArgName converts GraphQL variable name to argument name
// e.g., employeeId -> id (strips the entity prefix)
func (h *Handler) graphqlVarToArgName(varName string) string {
	// Simple heuristic: if variable ends with "Id", use just "id"
	// This handles cases like employeeId, userId, orderId -> id
	if strings.HasSuffix(varName, "Id") {
		return "id"
	}
	// If it contains "Id" in the middle, extract just the "id" part
	// e.g., employee_id -> id
	if strings.Contains(strings.ToLower(varName), "id") {
		return "id"
	}
	return varName
}

// determineOperationType determines the operation type from the method name prefix
// Protographic prefixes RPC methods with Query, Mutation, or Subscription
func (h *Handler) determineOperationType(methodName string) ast.OperationType {
	// Check for protographic prefixes
	if strings.HasPrefix(methodName, "Query") {
		log.Printf("Detected Query operation from method name: %s", methodName)
		return ast.OperationTypeQuery
	}
	
	if strings.HasPrefix(methodName, "Mutation") {
		log.Printf("Detected Mutation operation from method name: %s", methodName)
		return ast.OperationTypeMutation
	}
	
	if strings.HasPrefix(methodName, "Subscription") {
		log.Printf("Detected Subscription operation from method name: %s", methodName)
		return ast.OperationTypeSubscription
	}
	
	// Default to query if no prefix found
	log.Printf("No operation type prefix found in method name '%s', defaulting to Query", methodName)
	return ast.OperationTypeQuery
}

// methodNameToGraphQLField extracts the GraphQL field name from the Response message structure
// The field name comes from the first field in the Response message, NOT from the method name
// e.g., GetEmployeeByIdResponse { Employee employee = 1; } -> "employee"
func (h *Handler) methodNameToGraphQLField(methodName string, responseDesc protoreflect.MessageDescriptor) string {
	// The GraphQL field name is the name of the first field in the Response message
	// This follows the protographic convention where:
	// - Proto: message GetEmployeeByIdResponse { Employee employee = 1; }
	// - GraphQL: query GetEmployeeById { employee { ... } }
	fields := responseDesc.Fields()
	if fields.Len() > 0 {
		firstField := fields.Get(0)
		fieldName := string(firstField.Name())
		log.Printf("Extracted GraphQL field name '%s' from response message '%s'", fieldName, responseDesc.Name())
		return fieldName
	}
	
	// Fallback if no fields (shouldn't happen in practice)
	log.Printf("Warning: Response message '%s' has no fields, using 'data' as fallback", responseDesc.Name())
	return "data"
}

// protoFieldKindToGraphQLType maps proto field kind to GraphQL type
func (h *Handler) protoFieldKindToGraphQLType(field protoreflect.FieldDescriptor) string {
	switch field.Kind() {
	case protoreflect.BoolKind:
		return "Boolean!"
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		return "Int!"
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return "Int!"
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return "Int!"
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return "Int!"
	case protoreflect.FloatKind, protoreflect.DoubleKind:
		return "Float!"
	case protoreflect.StringKind:
		return "String!"
	case protoreflect.BytesKind:
		return "String!"
	default:
		return "String!"
	}
}

// buildGraphQLFieldsFromProto recursively builds GraphQL field selection from proto message
func (h *Handler) buildGraphQLFieldsFromProto(msgDesc protoreflect.MessageDescriptor, depth int) string {
	if depth > 10 {
		return "{}" // Prevent infinite recursion
	}
	
	var builder strings.Builder
	builder.WriteString("{\n")
	
	fields := msgDesc.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		fieldName := string(field.Name())
		
		// Add indentation
		builder.WriteString(strings.Repeat("  ", depth+1))
		builder.WriteString(fieldName)
		
		// If field is a message type, recurse
		if field.Kind() == protoreflect.MessageKind {
			nestedMsg := field.Message()
			builder.WriteString(" ")
			builder.WriteString(h.buildGraphQLFieldsFromProto(nestedMsg, depth+1))
		}
		
		builder.WriteString("\n")
	}
	
	builder.WriteString(strings.Repeat("  ", depth))
	builder.WriteString("}")
	
	return builder.String()
}

// protoValueToInterface converts a protoreflect.Value to a Go interface{}
func (h *Handler) protoValueToInterface(value protoreflect.Value, field protoreflect.FieldDescriptor) interface{} {
	switch field.Kind() {
	case protoreflect.BoolKind:
		return value.Bool()
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		return int32(value.Int())
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return value.Int()
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return uint32(value.Uint())
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return value.Uint()
	case protoreflect.FloatKind:
		return float32(value.Float())
	case protoreflect.DoubleKind:
		return value.Float()
	case protoreflect.StringKind:
		return value.String()
	case protoreflect.BytesKind:
		return value.Bytes()
	case protoreflect.MessageKind:
		// For nested messages, convert to JSON
		msg := value.Message().Interface()
		marshaler := protojson.MarshalOptions{}
		jsonBytes, _ := marshaler.Marshal(msg)
		var result interface{}
		json.Unmarshal(jsonBytes, &result)
		return result
	default:
		return value.Interface()
	}
}

// executeGraphQL executes a GraphQL query against the configured endpoint
func (h *Handler) executeGraphQL(ctx context.Context, query string, variables map[string]interface{}) (json.RawMessage, error) {
	// Create GraphQL request
	gqlReq := GraphQLRequest{
		Query:     query,
		Variables: variables,
	}

	reqBody, err := json.Marshal(gqlReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal GraphQL request: %w", err)
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", h.graphqlEndpoint, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	// Execute request
	resp, err := h.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to execute HTTP request: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Parse GraphQL response
	var gqlResp GraphQLResponse
	if err := json.Unmarshal(respBody, &gqlResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal GraphQL response: %w", err)
	}

	// Check for GraphQL errors
	if len(gqlResp.Errors) > 0 {
		var errorMessages []string
		for _, gqlErr := range gqlResp.Errors {
			errorMessages = append(errorMessages, gqlErr.Message)
		}
		return nil, fmt.Errorf("GraphQL errors: %s", strings.Join(errorMessages, "; "))
	}

	return gqlResp.Data, nil
}

// graphQLToProto converts GraphQL response data to a protobuf message
func (h *Handler) graphQLToProto(typeInfo *MessageTypeInfo, data json.RawMessage) (proto.Message, error) {
	// Parse the GraphQL response
	var responseData map[string]json.RawMessage
	if err := json.Unmarshal(data, &responseData); err != nil {
		return nil, fmt.Errorf("failed to parse GraphQL response: %w", err)
	}
	
	// Get the first field from the response type (the wrapper field)
	responseFields := typeInfo.ResponseType.Descriptor().Fields()
	if responseFields.Len() == 0 {
		return nil, fmt.Errorf("response type has no fields")
	}
	
	wrapperField := responseFields.Get(0)
	wrapperFieldName := string(wrapperField.Name())
	
	log.Printf("Looking for wrapper field '%s' in GraphQL response", wrapperFieldName)
	
	// Extract data from the GraphQL response using the wrapper field name
	extractedData, ok := responseData[wrapperFieldName]
	if !ok {
		// Log available fields for debugging
		var availableFields []string
		for key := range responseData {
			availableFields = append(availableFields, key)
		}
		log.Printf("Available fields in response: %v", availableFields)
		return nil, fmt.Errorf("field '%s' not found in GraphQL response", wrapperFieldName)
	}
	
	log.Printf("Extracted data from field '%s': %s", wrapperFieldName, string(extractedData))
	
	// Wrap the GraphQL data in the proto structure
	wrappedData := fmt.Sprintf(`{"%s": %s}`, wrapperFieldName, string(extractedData))
	
	log.Printf("Wrapped data for proto: %s", wrappedData)
	
	// Parse the wrapped JSON into a generic map first
	var jsonData map[string]interface{}
	if err := json.Unmarshal([]byte(wrappedData), &jsonData); err != nil {
		return nil, fmt.Errorf("failed to parse wrapped JSON: %w", err)
	}
	
	// Create a new dynamic message
	responseMsg := hyperpb.NewMessage(typeInfo.ResponseType)
	
	// Populate the message using reflection
	// hyperpb.Message implements protoreflect.Message interface
	if err := h.populateMessageFromJSON(responseMsg, jsonData); err != nil {
		return nil, fmt.Errorf("failed to populate proto message: %w", err)
	}

	return responseMsg, nil
}

// populateMessageFromJSON populates a protoreflect.Message from JSON data
func (h *Handler) populateMessageFromJSON(msg protoreflect.Message, data map[string]interface{}) error {
	msgDesc := msg.Descriptor()
	fields := msgDesc.Fields()
	
	for key, value := range data {
		// Find the field by name
		field := fields.ByName(protoreflect.Name(key))
		if field == nil {
			// Field not found, skip (DiscardUnknown behavior)
			log.Printf("Warning: field '%s' not found in message, skipping", key)
			continue
		}
		
		// Convert and set the value
		protoValue, err := h.jsonValueToProtoValue(value, field, msg)
		if err != nil {
			return fmt.Errorf("failed to convert field '%s': %w", key, err)
		}
		
		msg.Set(field, protoValue)
	}
	
	return nil
}

// jsonValueToProtoValue converts a JSON value to a protoreflect.Value
func (h *Handler) jsonValueToProtoValue(value interface{}, field protoreflect.FieldDescriptor, parentMsg protoreflect.Message) (protoreflect.Value, error) {
	if value == nil {
		return protoreflect.Value{}, nil
	}
	
	// Handle repeated fields first
	if field.IsList() {
		if arr, ok := value.([]interface{}); ok {
			// Get the mutable list from the parent message
			list := parentMsg.Mutable(field).List()
			
			for _, item := range arr {
				itemValue, err := h.jsonValueToProtoValue(item, field, parentMsg)
				if err != nil {
					return protoreflect.Value{}, err
				}
				list.Append(itemValue)
			}
			return protoreflect.ValueOfList(list), nil
		}
	}
	
	switch field.Kind() {
	case protoreflect.BoolKind:
		if b, ok := value.(bool); ok {
			return protoreflect.ValueOfBool(b), nil
		}
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfInt32(int32(f)), nil
		}
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfInt64(int64(f)), nil
		}
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfUint32(uint32(f)), nil
		}
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfUint64(uint64(f)), nil
		}
	case protoreflect.FloatKind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfFloat32(float32(f)), nil
		}
	case protoreflect.DoubleKind:
		if f, ok := value.(float64); ok {
			return protoreflect.ValueOfFloat64(f), nil
		}
	case protoreflect.StringKind:
		if s, ok := value.(string); ok {
			return protoreflect.ValueOfString(s), nil
		}
	case protoreflect.MessageKind:
		// Handle nested messages
		if m, ok := value.(map[string]interface{}); ok {
			// Use the FileDescriptorSet to compile the nested message type
			nestedMsgType, err := hyperpb.CompileFileDescriptorSet(h.fds, field.Message().FullName())
			if err != nil {
				return protoreflect.Value{}, fmt.Errorf("failed to compile nested message type: %w", err)
			}
			nestedMsg := hyperpb.NewMessage(nestedMsgType)
			if err := h.populateMessageFromJSON(nestedMsg, m); err != nil {
				return protoreflect.Value{}, err
			}
			return protoreflect.ValueOfMessage(nestedMsg), nil
		}
	case protoreflect.BytesKind:
		if s, ok := value.(string); ok {
			return protoreflect.ValueOfBytes([]byte(s)), nil
		}
	}
	
	return protoreflect.Value{}, fmt.Errorf("unsupported type conversion for field kind: %v", field.Kind())
}

// writeError writes a Connect error response.
func (h *Handler) writeError(w http.ResponseWriter, err error) {
	// Convert to Connect error if not already one
	var connectErr *connect.Error
	ok := errors.As(err, &connectErr)
	if !ok {
		connectErr = connect.NewError(connect.CodeInternal, err)
	}

	// Map Connect code to HTTP status code
	httpStatus := codeToHTTPStatus(connectErr.Code())

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)

	// Write error as JSON
	errorJSON := fmt.Sprintf(`{"code":"%s","message":"%s"}`, connectErr.Code(), connectErr.Message())
	if _, writeErr := w.Write([]byte(errorJSON)); writeErr != nil {
		log.Printf("Failed to write error response: %v", writeErr)
	}
}

// codeToHTTPStatus maps Connect error codes to HTTP status codes.
func codeToHTTPStatus(code connect.Code) int {
	switch code {
	case connect.CodeCanceled:
		return 499 // Client Closed Request
	case connect.CodeUnknown:
		return http.StatusInternalServerError
	case connect.CodeInvalidArgument:
		return http.StatusBadRequest
	case connect.CodeDeadlineExceeded:
		return http.StatusGatewayTimeout
	case connect.CodeNotFound:
		return http.StatusNotFound
	case connect.CodeAlreadyExists:
		return http.StatusConflict
	case connect.CodePermissionDenied:
		return http.StatusForbidden
	case connect.CodeResourceExhausted:
		return http.StatusTooManyRequests
	case connect.CodeFailedPrecondition:
		return http.StatusPreconditionFailed
	case connect.CodeAborted:
		return http.StatusConflict
	case connect.CodeOutOfRange:
		return http.StatusBadRequest
	case connect.CodeUnimplemented:
		return http.StatusNotImplemented
	case connect.CodeInternal:
		return http.StatusInternalServerError
	case connect.CodeUnavailable:
		return http.StatusServiceUnavailable
	case connect.CodeDataLoss:
		return http.StatusInternalServerError
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized
	default:
		return http.StatusInternalServerError
	}
}

// extractMethodName extracts the method name from the request path.
// Expected format: /package.Service/Method
func extractMethodName(path string) string {
	// Remove leading slash
	path = strings.TrimPrefix(path, "/")

	// Split by slash to get service and method
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		return ""
	}

	// Return full method name: package.Service/Method
	return path
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// extractServices extracts all service names from the FileDescriptorSet.
func extractServices(fds *descriptorpb.FileDescriptorSet) ([]string, error) {
	services := make([]string, 0)

	// Create a Files registry first to resolve dependencies
	files, err := protodesc.NewFiles(fds)
	if err != nil {
		return nil, fmt.Errorf("failed to create files registry: %w", err)
	}

	// Iterate through all files and extract services
	for _, fileDesc := range fds.GetFile() {
		// Use the Files registry to get the file descriptor with resolved dependencies
		fd, err := files.FindFileByPath(fileDesc.GetName())
		if err != nil {
			return nil, fmt.Errorf("failed to find file descriptor for %s: %w", fileDesc.GetName(), err)
		}

		svcDescs := fd.Services()
		for i := 0; i < svcDescs.Len(); i++ {
			service := svcDescs.Get(i)
			services = append(services, string(service.FullName()))
		}
	}

	return services, nil
}
