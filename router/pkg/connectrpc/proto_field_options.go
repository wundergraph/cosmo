package connectrpc

import "google.golang.org/protobuf/reflect/protoreflect"

// Protocol Buffer field option constants for ConnectRPC integration
//
// These constants define custom field options used to bridge protobuf and GraphQL.
// Field numbers are in the user-defined extension range (1000-536870911) as per
// the protobuf specification.

// GraphQLVariableNameFieldNumber is the field number for the graphql_variable_name option.
//
// This option specifies the exact GraphQL variable name to use for a protobuf field
// when the GraphQL variable name doesn't match the expected protobuf JSON format
// (camelCase of snake_case field name).
//
// The extension can be declared locally in any package for portability:
//
//	package employee.v1;
//
//	extend google.protobuf.FieldOptions {
//	  string graphql_variable_name = 50001;
//	}
//
//	message FindEmployeesByCriteriaRequest {
//	  bool has_pets = 1 [(employee.v1.graphql_variable_name) = "HAS_PETS"];
//	}
//
// Or imported from the canonical annotations.proto:
//
//	import "com/wundergraph/connectrpc/options/v1/annotations.proto";
//
//	message FindEmployeesByCriteriaRequest {
//	  bool has_pets = 1 [(com.wundergraph.connectrpc.options.v1.graphql_variable_name) = "HAS_PETS"];
//	}
const GraphQLVariableNameFieldNumber protoreflect.FieldNumber = 50001
