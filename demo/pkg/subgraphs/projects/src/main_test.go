package main

import (
	"context"
	"net"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

const bufSize = 1024 * 1024

// testService is a wrapper that holds the gRPC test components
type testService struct {
	grpcConn *grpc.ClientConn
	client   projects.ProjectsServiceClient
	cleanup  func()
}

// setupTestService creates a local gRPC server for testing
func setupTestService(t *testing.T) *testService {
	// Create a buffer for gRPC connections
	lis := bufconn.Listen(bufSize)

	// Create a new gRPC server
	grpcServer := grpc.NewServer()

	// Register our service
	projects.RegisterProjectsServiceServer(grpcServer, &service.ProjectsService{
		NextID: 1,
	})

	// Start the server
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			t.Fatalf("failed to serve: %v", err)
		}
	}()

	// Create a client connection
	dialer := func(context.Context, string) (net.Conn, error) {
		return lis.Dial()
	}
	conn, err := grpc.Dial(
		"passthrough:///bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	// Create the service client
	client := projects.NewProjectsServiceClient(conn)

	// Return cleanup function
	cleanup := func() {
		conn.Close()
		grpcServer.Stop()
	}

	return &testService{
		grpcConn: conn,
		client:   client,
		cleanup:  cleanup,
	}
}

func TestQueryProjects(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	resp, err := svc.client.QueryProjects(context.Background(), &projects.QueryProjectsRequest{})
	require.NoError(t, err)
	assert.NotNil(t, resp.Projects)
	assert.Len(t, resp.Projects, 7) // Based on the data in projects.go
}

func TestQueryProject(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name    string
		id      string
		wantErr bool
	}{
		{
			name:    "existing project",
			id:      "1",
			wantErr: false,
		},
		{
			name:    "non-existent project",
			id:      "999",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.client.QueryProject(context.Background(), &projects.QueryProjectRequest{Id: tt.id})
			if tt.wantErr {
				assert.Error(t, err)
				assert.Equal(t, codes.NotFound, status.Code(err))
				return
			}

			require.NoError(t, err)
			assert.NotNil(t, resp.Project)
			assert.Equal(t, tt.id, resp.Project.Id)
		})
	}
}

func TestQueryProjectStatuses(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	resp, err := svc.client.QueryProjectStatuses(context.Background(), &projects.QueryProjectStatusesRequest{})
	require.NoError(t, err)
	assert.NotNil(t, resp.ProjectStatuses)
	assert.Len(t, resp.ProjectStatuses, 4) // ACTIVE, PLANNING, ON_HOLD, COMPLETED
}

func TestQueryProjectsByStatus(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name   string
		status projects.ProjectStatus
		count  int
	}{
		{
			name:   "active projects",
			status: projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
			count:  4, // Based on the data
		},
		{
			name:   "planning projects",
			status: projects.ProjectStatus_PROJECT_STATUS_PLANNING,
			count:  1,
		},
		{
			name:   "on hold projects",
			status: projects.ProjectStatus_PROJECT_STATUS_ON_HOLD,
			count:  1,
		},
		{
			name:   "completed projects",
			status: projects.ProjectStatus_PROJECT_STATUS_COMPLETED,
			count:  1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.client.QueryProjectsByStatus(context.Background(), &projects.QueryProjectsByStatusRequest{
				Status: tt.status,
			})
			require.NoError(t, err)
			assert.NotNil(t, resp.ProjectsByStatus)
			assert.Len(t, resp.ProjectsByStatus, tt.count)
		})
	}
}

func TestLookupProjectById(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name    string
		ids     []string
		wantErr bool
	}{
		{
			name:    "existing project",
			ids:     []string{"1"},
			wantErr: false,
		},
		{
			name:    "non-existent project",
			ids:     []string{"999"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			keys := make([]*projects.LookupProjectByIdRequestKey, len(tt.ids))
			for i, id := range tt.ids {
				keys[i] = &projects.LookupProjectByIdRequestKey{Id: id}
			}

			resp, err := svc.client.LookupProjectById(context.Background(), &projects.LookupProjectByIdRequest{
				Keys: keys,
			})
			if tt.wantErr {
				assert.Error(t, err)
				assert.Equal(t, codes.NotFound, status.Code(err))
				return
			}

			require.NoError(t, err)
			assert.NotNil(t, resp.Result)
			assert.Len(t, resp.Result, 1)
			assert.Equal(t, tt.ids[0], resp.Result[0].Id)
		})
	}
}

func TestLookupEmployeeById(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name    string
		ids     []int32
		wantErr bool
	}{
		{
			name:    "existing employee",
			ids:     []int32{1},
			wantErr: false,
		},
		{
			name:    "non-existent employee",
			ids:     []int32{999},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			keys := make([]*projects.LookupEmployeeByIdRequestKey, len(tt.ids))
			for i, id := range tt.ids {
				keys[i] = &projects.LookupEmployeeByIdRequestKey{Id: strconv.Itoa(int(id))}
			}

			resp, err := svc.client.LookupEmployeeById(context.Background(), &projects.LookupEmployeeByIdRequest{
				Keys: keys,
			})
			if tt.wantErr {
				assert.Error(t, err)
				assert.Equal(t, codes.NotFound, status.Code(err))
				return
			}

			require.NoError(t, err)
			assert.NotNil(t, resp.Result)
			assert.Len(t, resp.Result, 1)
			assert.Equal(t, tt.ids[0], resp.Result[0].Id)
		})
	}
}

func TestMutationAddProject(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	newProject := &projects.ProjectInput{
		Name:        "Test Project",
		Description: &wrapperspb.StringValue{Value: "Test Description"},
		Status:      projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:   &wrapperspb.StringValue{Value: "2024-01-01"},
		EndDate:     &wrapperspb.StringValue{Value: "2024-12-31"},
	}

	resp, err := svc.client.MutationAddProject(context.Background(), &projects.MutationAddProjectRequest{
		Project: newProject,
	})
	require.NoError(t, err)
	assert.NotNil(t, resp.AddProject)
	assert.Equal(t, "8", resp.AddProject.Id) // Next ID after the last project in data
	assert.Equal(t, newProject.Name, resp.AddProject.Name)
	assert.Equal(t, newProject.Description, resp.AddProject.Description)
	assert.Equal(t, newProject.Status, resp.AddProject.Status)
	assert.Equal(t, newProject.StartDate, resp.AddProject.StartDate)
	assert.Equal(t, newProject.EndDate, resp.AddProject.EndDate)
}

func TestQueryPanic(t *testing.T) {
	t.Skip("Skipping because panics in gRPC handlers crash the test server. This is only meant for testing the router.")
}

func TestQueryKillService(t *testing.T) {
	t.Skip("Skipping because it kills the test server. This is only meant for testing the router.")
}
