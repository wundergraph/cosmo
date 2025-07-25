package connectrpc

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestReadMapping_Invalid(t *testing.T) {
	buf := bytes.NewBufferString("invalid")
	_, err := readMapping(buf)
	require.Error(t, err)
}

func TestReadMapping_Valid(t *testing.T) {
	buf := bytes.NewBufferString(`{
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupUserByIdRequest",
            "response": "LookupUserByIdResponse",
            "rpc": "LookupUserById",
            "typeName": "User"
          }
        ],
        "operationMappings": [
          {
            "mapped": "QueryTestQueryUser",
            "original": "user(id: \"1\") { id name details { age } }",
            "request": "QueryTestQueryUserRequest",
            "response": "QueryTestQueryUserResponse",
            "type": "OPERATION_TYPE_QUERY"
          }
        ],
        "service": "UserService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id"
              },
              {
                "mapped": "name",
                "original": "name"
              },
              {
                "mapped": "details",
                "original": "details"
              }
            ],
            "type": "User"
          },
          {
            "fieldMappings": [
              {
                "mapped": "age",
                "original": "age"
              }
            ],
            "type": "UserDetails"
          }
        ],
        "version": 1
      }`)
	mapping, err := readMapping(buf)
	require.NoError(t, err)
	require.Equal(t, "UserService", mapping.Service)
	require.Equal(t, int32(1), mapping.Version)
	require.Equal(t, 1, len(mapping.EntityMappings))
	require.Equal(t, 1, len(mapping.OperationMappings))
	require.Equal(t, 2, len(mapping.TypeFieldMappings))
	require.Equal(t, 0, len(mapping.EnumMappings))
}

func TestGraphQLResponseToConnectrpc(t *testing.T) {
	graphqlResponse := `
	{
		"data": {
			"TestQueryUser": {
				"id": "1",
				"name": "John Doe",
				"details": {
					"age": 30
				}
			}
		}
	}
	`

	protoFile, err := os.ReadFile("testdata/base.proto")
	require.NoError(t, err)

	fd, err := fileDescriptorProto(string(protoFile), context.Background())
	require.NoError(t, err)
	require.NotNil(t, fd)

	mapperData, err := os.Open("testdata/base.mapper.json")
	require.NoError(t, err)

	mapping, err := readMapping(mapperData)
	require.NoError(t, err)
	require.NotNil(t, mapping)

	connectrpc, err := graphqlToRPC(fd, "QueryTestQueryUser", mapping, graphqlResponse)
	require.NoError(t, err)
	require.NotNil(t, connectrpc)
	json, err := protojson.Marshal(connectrpc)
	require.NoError(t, err)
	require.JSONEq(t, `{"id":"1","name":"John Doe","details":{"age":30}}`, string(json))

}
