package connectrpc

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/bufbuild/protocompile/linker"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
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

func getFieldsMapping(mapping *nodev1.GRPCMapping, typeName string) []*nodev1.FieldMapping {
	// map to base entity
	var entityMapping *nodev1.EntityMapping
	for _, entity := range mapping.EntityMappings {
		if entity.Response == typeName {
			entityMapping = entity
			break
		}
	}

	var responseTypeMapping []*nodev1.FieldMapping
	for _, typeMapping := range mapping.TypeFieldMappings {
		if typeMapping.Type == entityMapping.TypeName {
			responseTypeMapping = typeMapping.FieldMappings
			break
		}
	}

	return responseTypeMapping
}

func graphqlToRPC(protoFd linker.File, mapping *nodev1.GRPCMapping, graphqlResponse string) (*dynamicpb.Message, error) {

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
	for i := 0; i < protoFd.Messages().Len(); i++ {
		mt := protoFd.Messages().Get(i)
		responseTypes[string(mt.Name())] = mt
	}
	responseType := responseTypes[responseTypeName]

	// Create dynamic message
	dynamicMsg := dynamicpb.NewMessage(responseType)

	responseTypeMapping := getFieldsMapping(mapping, responseTypeName)

	protoFields := responseType.Fields()
	for _, fieldMapping := range responseTypeMapping {
		field := protoFields.ByName(protoreflect.Name(fieldMapping.Mapped))
		switch field.Kind() {
		case protoreflect.StringKind:
			dynamicMsg.Set(field, protoreflect.ValueOfString(resOperationData[fieldMapping.Original].(string)))
		case protoreflect.MessageKind:
			subMsg := dynamicpb.NewMessage(field.Message())
			subResponseName := string(field.Message().Name())
			subResponseType := responseTypes[subResponseName]
			subTypeMapping := getFieldsMapping(mapping, subResponseName)
			subOperationData := resOperationData[fieldMapping.Original].(map[string]any)
			for _, subFieldMapping := range subTypeMapping {
				subfield := subResponseType.Fields().ByName(protoreflect.Name(subFieldMapping.Mapped))
				switch subfield.Kind() {
				case protoreflect.StringKind:
					subMsg.Set(subfield, protoreflect.ValueOfString(subOperationData[subFieldMapping.Original].(string)))
				case protoreflect.Int32Kind:
					asInt32 := int32(subOperationData[subFieldMapping.Original].(float64))
					subMsg.Set(subfield, protoreflect.ValueOfInt32(asInt32))
				}
			}
			dynamicMsg.Set(field, protoreflect.ValueOfMessage(subMsg))
		default:
			return nil, fmt.Errorf("field %s of type %s is not supported", fieldMapping.Mapped, responseTypeName)
		}
	}

	return dynamicMsg, nil
}
