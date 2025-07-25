package integration

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
)

func TestConnectRPC(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	t.Run("test base url", func(t *testing.T) {
		t.Parallel()

		opts := []core.Option{
			core.WithConnectRPC("/graphql", core.ConnectRPCPrefix, []connectrpc.ConnectRPCData{
				{
					Schema: `syntax = "proto3";
					package service.v1;

					service EmployeeService {
						rpc QueryGetEmployee(QueryGetEmployeeRequest) returns (QueryGetEmployeeResponse);
					}

					message QueryGetEmployeeRequest {
						int32 id = 1;
					}

					message QueryGetEmployeeResponse {
						int32 id = 1;
						QueryGetEmployeeResponseEmployeeDetails details = 2;
					}

					message QueryGetEmployeeResponseEmployeeDetails {
						string forename = 1;
						string surname = 2;
					}
					`,
					Mapping: &nodev1.GRPCMapping{
						EntityMappings: []*nodev1.EntityMapping{
							{
								Key:      "id",
								Kind:     "entity",
								Request:  "LookupUserByIdRequest",
								Response: "QueryGetEmployeeResponse",
								Rpc:      "LookupUserById",
								TypeName: "Employee",
							},
							{
								Key:      "id",
								Kind:     "entity",
								Request:  "LookupUserByIdRequest",
								Response: "QueryGetEmployeeResponseEmployeeDetails",
								Rpc:      "LookupUserById",
								TypeName: "EmployeeDetails",
							},
						},
						OperationMappings: []*nodev1.OperationMapping{
							{
								Original: "TestQueryUser",
								Response: "QueryGetEmployeeResponse",
								OriginalQuery: `query GetEmployee($id: Int!) {
									employee(id: $id) {
										id
										details {
											forename
											surname
										}
									}
								}`,
								Mapped: "QueryGetEmployee",
							},
						},
						TypeFieldMappings: []*nodev1.TypeFieldMapping{
							{
								FieldMappings: []*nodev1.FieldMapping{
									{
										Mapped:   "id",
										Original: "id",
									},
									{
										Mapped:   "name",
										Original: "name",
									},
									{
										Mapped:   "details",
										Original: "details",
									},
								},
								Type: "Employee",
							},
							{
								FieldMappings: []*nodev1.FieldMapping{
									{
										Mapped:   "age",
										Original: "age",
									},
								},
								Type: "EmployeeDetails",
							},
						},
					},
				},
			}),
		}

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: opts,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			urlPath, err := url.JoinPath(xEnv.RouterURL, "/connectrpc/service.v1.EmployeeService/QueryGetEmployee")
			require.NoError(t, err)
			req, err := http.NewRequest("POST", urlPath, strings.NewReader(`{"id": 1}`))
			req.Header.Add("Content-Type", "application/json")
			require.NoError(t, err)
			res, err := xEnv.MakeGraphQLRequestRaw(req)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})
	})
}
