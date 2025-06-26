package connectrpc

import (
	"encoding/json"
	"fmt"
	"io"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	grpcdatasource "github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/grpc_datasource"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

func readMapping(buf io.Reader) (*nodev1.GRPCMapping, error) {
	mapping := &nodev1.GRPCMapping{}
	data, err := io.ReadAll(buf)
	if err != nil {
		return nil, err
	}
	if err := protojson.Unmarshal(data, mapping); err != nil {
		return nil, err
	}

	return mapping, nil
}

func graphqlToRPC(protoFd *descriptorpb.FileDescriptorProto, mapping *nodev1.GRPCMapping, graphqlResponse string) (*dynamicpb.Message, error) {
	compiler, err := grpcdatasource.NewProtoCompiler(protoFd.String(), mapping)

	// Parse GraphQL response JSON
	var gqlResp map[string]interface{}
	if err := json.Unmarshal([]byte(graphqlResponse), &gqlResp); err != nil {
		return nil, fmt.Errorf("failed to parse GraphQL response: %v", err)
	}

	// Extract the data from GraphQL response
	data, ok := gqlResp["data"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("GraphQL response missing data field")
	}

	var resOperationName string
	var resOperationData map[string]interface{}
	for k, v := range data {
		// TODO: handle multiple operations
		resOperationName = k
		resOperationData = v.(map[string]interface{})
		break
	}

	// Find the operation mapping to get the response type
	var responseTypeName string
	for _, opMapping := range mapping.OperationMappings {
		if opMapping.Original == resOperationName {
			responseTypeName = opMapping.Response
			break
		}
	}

	if resOperationData == nil {
		return nil, fmt.Errorf("no operation data found in GraphQL response")
	}

	if responseTypeName == "" {
		return nil, fmt.Errorf("no operation mapping found")
	}

	// Find the response message type
	responseTypes := make(map[string]protoreflect.MessageDescriptor)
	for _, mt := range protoFd.GetMessageType() {
		if mt.GetName() == responseTypeName {
			responseTypes[mt.GetName()] = mt
		}
	}
	responseType := responseTypes[responseTypeName]

	// Create dynamic message
	dynamicMsg := dynamicpb.NewMessage(responseType)

	// map to base entity
	var entityMapping *nodev1.EntityMapping
	for _, entity := range mapping.EntityMappings {
		if entity.Response == responseTypeName {
			entityMapping = entity
			break
		}
	}

	// Get the GraphQL data for the operation (assuming "TestQueryUser" key)

	var responseTypeMapping []*nodev1.FieldMapping
	for _, typeMapping := range mapping.TypeFieldMappings {
		if typeMapping.Type == entityMapping.TypeName {
			responseTypeMapping = typeMapping.FieldMappings
			break
		}
	}

	protoFields := responseType.Fields()
	for _, fieldMapping := range responseTypeMapping {
		field := protoFields.ByName(protoreflect.Name(fieldMapping.Mapped))
		if field != nil {
			dynamicMsg.Set(field, protoreflect.ValueOfString(resOperationData[fieldMapping.Original].(string)))
		}
	}

	return dynamicMsg, nil
}
