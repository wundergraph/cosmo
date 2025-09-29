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
			t.Errorf("failed to serve: %v", err)
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
	assert.Len(t, resp.ProjectStatuses, 3) // ACTIVE, PLANNING, ON_HOLD (no completed projects in current data)
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
			count:  5, // Projects 1, 2, 3, 6, 7
		},
		{
			name:   "planning projects",
			status: projects.ProjectStatus_PROJECT_STATUS_PLANNING,
			count:  1, // Project 4
		},
		{
			name:   "on hold projects",
			status: projects.ProjectStatus_PROJECT_STATUS_ON_HOLD,
			count:  1, // Project 5
		},
		{
			name:   "completed projects",
			status: projects.ProjectStatus_PROJECT_STATUS_COMPLETED,
			count:  0, // No completed projects in current data
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.client.QueryProjectsByStatus(context.Background(), &projects.QueryProjectsByStatusRequest{
				Status: tt.status,
			})
			require.NoError(t, err)
			if tt.count == 0 {
				// For zero results, the response might be nil or empty slice
				assert.True(t, len(resp.ProjectsByStatus) == 0)
			} else {
				assert.NotNil(t, resp.ProjectsByStatus)
				assert.Len(t, resp.ProjectsByStatus, tt.count)
			}
		})
	}
}

func TestLookupProjectById(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name        string
		ids         []string
		expectEmpty []bool
	}{
		{
			name:        "existing project",
			ids:         []string{"1"},
			expectEmpty: []bool{false},
		},
		{
			name:        "non-existent project",
			ids:         []string{"999"},
			expectEmpty: []bool{true}, // Returns empty object for missing entities
		},
		{
			name:        "mixed existing and non-existent",
			ids:         []string{"1", "999", "2"},
			expectEmpty: []bool{false, true, false},
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
			require.NoError(t, err) // Lookup should not error, even for missing items
			assert.NotNil(t, resp.Result)
			assert.Len(t, resp.Result, len(tt.ids))

			for i, expectEmpty := range tt.expectEmpty {
				if expectEmpty {
					// Check for empty object (gRPC converts nil to empty objects)
					assert.Equal(t, "", resp.Result[i].Id, "Expected empty result for ID %s", tt.ids[i])
				} else {
					assert.NotEqual(t, "", resp.Result[i].Id, "Expected non-empty result for ID %s", tt.ids[i])
					assert.Equal(t, tt.ids[i], resp.Result[i].Id)
				}
			}
		})
	}
}

func TestLookupEmployeeById(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	tests := []struct {
		name        string
		ids         []int32
		expectEmpty []bool
	}{
		{
			name:        "existing employee",
			ids:         []int32{1},
			expectEmpty: []bool{false},
		},
		{
			name:        "non-existent employee",
			ids:         []int32{999},
			expectEmpty: []bool{true}, // Returns empty object for missing entities
		},
		{
			name:        "mixed existing and non-existent",
			ids:         []int32{1, 999, 2},
			expectEmpty: []bool{false, true, false},
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
			require.NoError(t, err) // Lookup should not error, even for missing items
			assert.NotNil(t, resp.Result)
			assert.Len(t, resp.Result, len(tt.ids))

			for i, expectEmpty := range tt.expectEmpty {
				if expectEmpty {
					// Check for empty object (gRPC converts nil to empty objects)
					assert.Equal(t, int32(0), resp.Result[i].Id, "Expected empty result for ID %d", tt.ids[i])
				} else {
					assert.NotEqual(t, int32(0), resp.Result[i].Id, "Expected non-empty result for ID %d", tt.ids[i])
					assert.Equal(t, tt.ids[i], resp.Result[i].Id)
				}
			}
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
	assert.Equal(t, newProject.Description.Value, resp.AddProject.Description.Value)
	assert.Equal(t, newProject.Status, resp.AddProject.Status)
	assert.Equal(t, newProject.StartDate.Value, resp.AddProject.StartDate.Value)
	assert.Equal(t, newProject.EndDate.Value, resp.AddProject.EndDate.Value)
}

// Test for the new nested list functionality
func TestQueryTasksByPriority(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	resp, err := svc.client.QueryTasksByPriority(context.Background(), &projects.QueryTasksByPriorityRequest{
		ProjectId: "1", // Cloud Migration project has several tasks
	})
	require.NoError(t, err)
	assert.NotNil(t, resp.TasksByPriority)
	assert.NotNil(t, resp.TasksByPriority.List)
	assert.Greater(t, len(resp.TasksByPriority.List.Items), 0, "Should have task groups by priority")
}

// Test for the new resource matrix functionality
func TestQueryResourceMatrix(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	resp, err := svc.client.QueryResourceMatrix(context.Background(), &projects.QueryResourceMatrixRequest{
		ProjectId: "1", // Cloud Migration project
	})
	require.NoError(t, err)
	assert.NotNil(t, resp.ResourceMatrix)
	assert.NotNil(t, resp.ResourceMatrix.List)
	assert.Greater(t, len(resp.ResourceMatrix.List.Items), 0, "Should have resource groups")
}

// Test for project history nested list functionality
func TestEmployeeProjectHistory(t *testing.T) {
	svc := setupTestService(t)
	defer svc.cleanup()

	// Test that employees with history have properly structured nested lists
	resp, err := svc.client.LookupEmployeeById(context.Background(), &projects.LookupEmployeeByIdRequest{
		Keys: []*projects.LookupEmployeeByIdRequestKey{{Id: "1"}}, // Employee with history
	})
	require.NoError(t, err)
	assert.NotNil(t, resp.Result)
	assert.Len(t, resp.Result, 1)

	employee := resp.Result[0]
	assert.NotNil(t, employee.ProjectHistory, "Employee should have project history")
	assert.NotNil(t, employee.ProjectHistory.List, "Project history should have list structure")
	assert.Greater(t, len(employee.ProjectHistory.List.Items), 0, "Should have historical project groups")

	// Count groups with actual projects (gRPC converts nil to empty objects)
	groupsWithProjects := 0
	for _, group := range employee.ProjectHistory.List.Items {
		if group != nil && group.List != nil && len(group.List.Items) > 0 {
			groupsWithProjects++
		}
	}
	assert.Greater(t, groupsWithProjects, 0, "Should have at least one project group with projects")

	// Test an employee with different history pattern (employee 2)
	resp2, err := svc.client.LookupEmployeeById(context.Background(), &projects.LookupEmployeeByIdRequest{
		Keys: []*projects.LookupEmployeeByIdRequestKey{{Id: "2"}}, // Employee with more complex history
	})
	require.NoError(t, err)
	assert.NotNil(t, resp2.Result)
	assert.Len(t, resp2.Result, 1)

	employee2 := resp2.Result[0]
	assert.NotNil(t, employee2.ProjectHistory, "Employee 2 should have project history")
	assert.NotNil(t, employee2.ProjectHistory.List, "Employee 2 project history should have list structure")

	// Count employee 2's project groups
	employee2GroupsWithProjects := 0
	for _, group := range employee2.ProjectHistory.List.Items {
		if group != nil && group.List != nil && len(group.List.Items) > 0 {
			employee2GroupsWithProjects++
		}
	}
	assert.Greater(t, employee2GroupsWithProjects, 0, "Employee 2 should have project groups with projects")
}

func TestQueryPanic(t *testing.T) {
	t.Skip("Skipping because panics in gRPC handlers crash the test server. This is only meant for testing the router.")
}

func TestQueryKillService(t *testing.T) {
	t.Skip("Skipping because it kills the test server. This is only meant for testing the router.")
}
