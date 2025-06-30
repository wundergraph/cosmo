package integration

import (
	"net/http"
	"net/url"
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
			core.WithConnectRPC(core.ConnectRPCPrefix, []connectrpc.ConnectRPCData{
				{
					Schema: `
					service EmployeeService {
						rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
					}

					message GetEmployeeRequest {
						int32 id = 1;
					}

					message GetEmployeeResponse {
						Employee employee = 1;
					}`,
					Mapping: &nodev1.GRPCMapping{
						OperationMappings: []*nodev1.OperationMapping{
							{
								OriginalQuery: `query GetEmployee($id: Int!) {
									employee(id: $id) {
										id
										details {
											forename
											surname
										}
									}
								}`,
								Mapped: "GetEmployee",
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
			urlPath, err := url.JoinPath(xEnv.RouterURL, "/connectrpc/v1/employees/1")
			require.NoError(t, err)
			req, err := http.NewRequest("GET", urlPath, nil)
			require.NoError(t, err)
			res, err := xEnv.MakeGraphQLRequestRaw(req)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})
	})
}
