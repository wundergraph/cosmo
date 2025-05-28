package main

import (
	"context"
	"log"
	"strconv"
	"sync"
	"syscall"

	service "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/data"

	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func main() {
	pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
		s.RegisterService(&service.ProjectsService_ServiceDesc, &ProjectsService{
			nextID: 1,
		})
	})

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	pl.Serve()
}

var _ service.ProjectsServiceServer = &ProjectsService{}

type ProjectsService struct {
	service.UnimplementedProjectsServiceServer
	lock   sync.RWMutex
	nextID int
}

// QueryKillService implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryKillService(context.Context, *service.QueryKillServiceRequest) (*service.QueryKillServiceResponse, error) {
	syscall.Kill(syscall.Getpid(), syscall.SIGKILL)

	return &service.QueryKillServiceResponse{
		KillService: true,
	}, nil
}

// QueryPanic implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryPanic(context.Context, *service.QueryPanicRequest) (*service.QueryPanicResponse, error) {
	panic("Panic")
}

// LookupEmployeeById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupEmployeeById(ctx context.Context, req *service.LookupEmployeeByIdRequest) (*service.LookupEmployeeByIdResponse, error) {
	var result []*service.Employee

	for _, employee := range data.Employees {
		for _, key := range req.Keys {
			id, err := strconv.ParseInt(key.Id, 10, 32)
			if err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "invalid employee id: %v", err)
			}

			if employee.Id == int32(id) {
				result = append(result, employee)
			}
		}
	}

	if len(result) == 0 {
		return nil, status.Errorf(codes.NotFound, "employee not found")
	}

	return &service.LookupEmployeeByIdResponse{
		Result: result,
	}, nil
}

// LookupProductByUpc implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupProductByUpc(context.Context, *service.LookupProductByUpcRequest) (*service.LookupProductByUpcResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method LookupProductByUpc not implemented")
}

// LookupProjectById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupProjectById(ctx context.Context, req *service.LookupProjectByIdRequest) (*service.LookupProjectByIdResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Project

	for _, project := range data.ServiceProjects {
		for _, key := range req.Keys {
			if project.Id == key.Id {
				result = append(result, project)
			}
		}
	}

	if len(result) == 0 {
		return nil, status.Errorf(codes.NotFound, "project not found")
	}

	return &service.LookupProjectByIdResponse{Result: result}, nil
}

// MutationAddProject implements projects.ProjectsServiceServer.
func (p *ProjectsService) MutationAddProject(ctx context.Context, req *service.MutationAddProjectRequest) (*service.MutationAddProjectResponse, error) {
	p.lock.Lock()
	defer p.lock.Unlock()

	lastID := data.ServiceProjects[len(data.ServiceProjects)-1].Id

	nextID, err := strconv.Atoi(lastID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to convert lastID to int: %v", err)
	}

	nextID++

	project := &service.Project{
		Id:          strconv.Itoa(nextID),
		Name:        req.Project.Name,
		Description: req.Project.Description,
		Status:      req.Project.Status,
		StartDate:   req.Project.StartDate,
		EndDate:     req.Project.EndDate,
	}

	data.ServiceProjects = append(data.ServiceProjects, project)

	return &service.MutationAddProjectResponse{AddProject: project}, nil
}

// QueryProject implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProject(ctx context.Context, req *service.QueryProjectRequest) (*service.QueryProjectResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	for _, project := range data.ServiceProjects {
		if project.Id == req.Id {
			return &service.QueryProjectResponse{Project: project}, nil
		}
	}

	return nil, status.Errorf(codes.NotFound, "project not found")
}

// QueryProjectStatuses implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectStatuses(context.Context, *service.QueryProjectStatusesRequest) (*service.QueryProjectStatusesResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	sm := make(map[service.ProjectStatus]struct{})

	for _, proj := range data.ServiceProjects {
		sm[proj.Status] = struct{}{}
	}

	projectStatuses := make([]service.ProjectStatus, 0, len(sm))
	for status := range sm {
		projectStatuses = append(projectStatuses, status)
	}

	return &service.QueryProjectStatusesResponse{
		ProjectStatuses: projectStatuses,
	}, nil
}

// QueryProjects implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjects(ctx context.Context, req *service.QueryProjectsRequest) (*service.QueryProjectsResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	return &service.QueryProjectsResponse{Projects: data.ServiceProjects}, nil
}

// QueryProjectsByStatus implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectsByStatus(ctx context.Context, req *service.QueryProjectsByStatusRequest) (*service.QueryProjectsByStatusResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	projects := make([]*service.Project, 0)

	for _, proj := range data.ServiceProjects {
		if proj.Status == req.Status {
			projects = append(projects, proj)
		}
	}

	return &service.QueryProjectsByStatusResponse{ProjectsByStatus: projects}, nil
}
