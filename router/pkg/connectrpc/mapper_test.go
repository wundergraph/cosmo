package connectrpc

import (
	"bytes"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
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
	require.Equal(t, 1, mapping.Version)
	require.Equal(t, 1, len(mapping.EntityMappings))
	require.Equal(t, 1, len(mapping.OperationMappings))
	require.Equal(t, 1, len(mapping.TypeFieldMappings))
	require.Equal(t, 1, len(mapping.EnumMappings))
}

func TestConnectrpcToGraphqlQuery(t *testing.T) {
	mapperData, err := os.ReadFile("testdata/base.mapper.json")
	require.NoError(t, err)
	mapping, err := readMapping(bytes.NewBuffer(mapperData))

	protoData, err := os.ReadFile("testdata/base.proto")
	require.NoError(t, err)
	protoFile, err := protoutil.ParseFile(protoData)
	require.NoError(t, err)

	protoFile.Services().Get(0).Methods().Get(0).InputType()

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

	mapperData, err := os.ReadFile("testdata/base.mapper.json")
	protoMapping, err := readMapping(bytes.NewBuffer(mapperData))
	require.NoError(t, err)
	require.Equal(t, "UserService", protoMapping.Service)
	require.Equal(t, 1, len(protoMapping.OperationMappings))
	require.Equal(t, "QueryTestQueryUser", protoMapping.OperationMappings[0].Mapped)
	require.Equal(t, "QueryTestQueryUserRequest", protoMapping.OperationMappings[0].Request)
	require.Equal(t, "QueryTestQueryUserResponse", protoMapping.OperationMappings[0].Response)

}
