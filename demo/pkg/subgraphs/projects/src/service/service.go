package service

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	service "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/data"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

// Relationship mappings - easily configurable and maintainable
var (
	// projectToProductMap maps project IDs to product UPCs
	projectToProductMap = map[string][]string{
		"1": {"cosmo"},
		"2": {"cosmo"},
		"3": {"sdk"},
		"4": {"cosmo"},
		"5": {"consultancy"},
		"6": {"consultancy"},
		"7": {"sdk"},
	}
)

var _ service.ProjectsServiceServer = &ProjectsService{}

type ProjectsService struct {
	service.UnimplementedProjectsServiceServer
	lock   sync.RWMutex
	NextID int
}

// Helper functions to populate relationships
func (p *ProjectsService) populateProjectRelationships(project *service.Project) *service.Project {
	// Create a copy to avoid modifying the original
	populatedProject := &service.Project{
		Id:           project.Id,
		Name:         project.Name,
		Description:  project.Description,
		Status:       project.Status,
		StartDate:    project.StartDate,
		EndDate:      project.EndDate,
		MilestoneIds: project.MilestoneIds,
		Progress:     project.Progress,
		// Populate relationships
		Milestones:      data.GetMilestonesByProjectID(project.Id),
		Tasks:           data.GetTasksByProjectID(project.Id),
		TeamMembers:     data.GetTeamMembersByProjectId(project.Id),
		RelatedProducts: p.getRelatedProductsByProjectId(project.Id),
	}
	return populatedProject
}

func (p *ProjectsService) populateProjectUpdateRelationships(update *service.ProjectUpdate) *service.ProjectUpdate {
	// ProjectUpdate now only has ID references - no nested objects to populate
	return update
}

func (p *ProjectsService) getRelatedProductsByProjectId(projectId string) []*service.Product {
	var products []*service.Product

	// Use the configurable mapping instead of hardcoded switch-case
	if productUpcs, exists := projectToProductMap[projectId]; exists {
		for _, upc := range productUpcs {
			if product := data.GetProductByUpc(upc); product != nil {
				products = append(products, product)
			}
		}
	}

	return products
}

// LookupMilestoneById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupMilestoneById(ctx context.Context, req *service.LookupMilestoneByIdRequest) (*service.LookupMilestoneByIdResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Milestone

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, milestone := range data.ServiceMilestones {
			if milestone.Id == key.Id {
				result = append(result, milestone)
				found = true
				break
			}
		}
		if !found {
			result = append(result, nil)
		}
	}

	return &service.LookupMilestoneByIdResponse{Result: result}, nil
}

// LookupTaskById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupTaskById(ctx context.Context, req *service.LookupTaskByIdRequest) (*service.LookupTaskByIdResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Task

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, task := range data.ServiceTasks {
			if task.Id == key.Id {
				result = append(result, task)
				found = true
				break
			}
		}
		if !found {
			result = append(result, nil)
		}
	}

	return &service.LookupTaskByIdResponse{Result: result}, nil
}

// LookupProductByUpc implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupProductByUpc(ctx context.Context, req *service.LookupProductByUpcRequest) (*service.LookupProductByUpcResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Product

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, product := range data.ServiceProducts {
			if product.Upc == key.Upc {
				result = append(result, product)
				found = true
				break
			}
		}
		if !found {
			result = append(result, nil)
		}
	}

	return &service.LookupProductByUpcResponse{Result: result}, nil
}

// MutationAddMilestone implements projects.ProjectsServiceServer.
func (p *ProjectsService) MutationAddMilestone(ctx context.Context, req *service.MutationAddMilestoneRequest) (*service.MutationAddMilestoneResponse, error) {
	p.lock.Lock()
	defer p.lock.Unlock()

	var nextID int
	if len(data.ServiceMilestones) == 0 {
		nextID = 1
	} else {
		// Generate next ID
		lastID := data.ServiceMilestones[len(data.ServiceMilestones)-1].Id
		next, err := strconv.Atoi(lastID)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to convert lastID to int: %v", err)
		}
		nextID = next + 1
	}

	milestone := &service.Milestone{
		Id:                   strconv.Itoa(nextID),
		ProjectId:            req.Milestone.ProjectId,
		Name:                 req.Milestone.Name,
		Description:          req.Milestone.Description,
		StartDate:            nil, // Will be set when milestone work starts
		EndDate:              req.Milestone.DueDate,
		Status:               req.Milestone.Status,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 0.0},
	}

	data.ServiceMilestones = append(data.ServiceMilestones, milestone)

	return &service.MutationAddMilestoneResponse{AddMilestone: milestone}, nil
}

// MutationAddTask implements projects.ProjectsServiceServer.
func (p *ProjectsService) MutationAddTask(ctx context.Context, req *service.MutationAddTaskRequest) (*service.MutationAddTaskResponse, error) {
	p.lock.Lock()
	defer p.lock.Unlock()

	// Generate next ID
	lastID := data.ServiceTasks[len(data.ServiceTasks)-1].Id
	nextID, err := strconv.Atoi(lastID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to convert lastID to int: %v", err)
	}
	nextID++

	task := &service.Task{
		Id:             strconv.Itoa(nextID),
		ProjectId:      req.Task.ProjectId,
		AssigneeId:     req.Task.AssigneeId,
		Name:           req.Task.Name,
		Description:    req.Task.Description,
		Priority:       req.Task.Priority,
		Status:         req.Task.Status,
		EstimatedHours: req.Task.EstimatedHours,
		ActualHours:    &wrapperspb.DoubleValue{Value: 0.0},
		CreatedAt:      &wrapperspb.StringValue{Value: time.Now().Format(time.RFC3339)},
		CompletedAt:    nil,
	}

	data.ServiceTasks = append(data.ServiceTasks, task)

	return &service.MutationAddTaskResponse{AddTask: task}, nil
}

// MutationUpdateProjectStatus implements projects.ProjectsServiceServer.
func (p *ProjectsService) MutationUpdateProjectStatus(ctx context.Context, req *service.MutationUpdateProjectStatusRequest) (*service.MutationUpdateProjectStatusResponse, error) {
	p.lock.Lock()
	defer p.lock.Unlock()

	// Find and update the project
	var updatedProject *service.Project
	for _, project := range data.ServiceProjects {
		if project.Id == req.ProjectId {
			project.Status = req.Status
			updatedProject = project
			break
		}
	}

	if updatedProject == nil {
		return nil, status.Errorf(codes.NotFound, "project not found")
	}

	// Create project update record
	var nextID int
	if len(data.ServiceProjectUpdates) == 0 {
		nextID = 1
	} else {
		lastUpdateID := data.ServiceProjectUpdates[len(data.ServiceProjectUpdates)-1].Id
		next, err := strconv.Atoi(lastUpdateID)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to convert lastID to int: %v", err)
		}
		nextID = next + 1
	}

	projectUpdate := &service.ProjectUpdate{
		Id:          strconv.Itoa(nextID),
		ProjectId:   req.ProjectId,
		UpdatedById: 1,
		UpdateType:  service.ProjectUpdateType_PROJECT_UPDATE_TYPE_STATUS_CHANGE,
		Description: "Project status updated via API",
		Timestamp:   time.Now().Format(time.RFC3339),
		Metadata:    &wrapperspb.StringValue{Value: `{"new_status": "` + req.Status.String() + `"}`},
	}

	data.ServiceProjectUpdates = append(data.ServiceProjectUpdates, projectUpdate)

	return &service.MutationUpdateProjectStatusResponse{UpdateProjectStatus: p.populateProjectUpdateRelationships(projectUpdate)}, nil
}

// QueryMilestones implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryMilestones(ctx context.Context, req *service.QueryMilestonesRequest) (*service.QueryMilestonesResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	milestones := data.GetMilestonesByProjectID(req.ProjectId)
	// Populate relationships for all milestones
	var populatedMilestones []*service.Milestone
	populatedMilestones = append(populatedMilestones, milestones...)

	return &service.QueryMilestonesResponse{Milestones: populatedMilestones}, nil
}

// QueryTasks implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryTasks(ctx context.Context, req *service.QueryTasksRequest) (*service.QueryTasksResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	tasks := data.GetTasksByProjectID(req.ProjectId)
	// Populate relationships for all tasks
	var populatedTasks []*service.Task
	populatedTasks = append(populatedTasks, tasks...)

	return &service.QueryTasksResponse{Tasks: populatedTasks}, nil
}

// QueryProjectActivities implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectActivities(ctx context.Context, req *service.QueryProjectActivitiesRequest) (*service.QueryProjectActivitiesResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var activities []*service.ProjectActivity

	// Add project updates (populated with relationships)
	updates := data.GetProjectUpdatesByProjectID(req.ProjectId)
	for _, update := range updates {
		activities = append(activities, &service.ProjectActivity{
			Value: &service.ProjectActivity_ProjectUpdate{ProjectUpdate: update},
		})
	}

	// Add milestones (populated with relationships)
	milestones := data.GetMilestonesByProjectID(req.ProjectId)
	for _, milestone := range milestones {
		activities = append(activities, &service.ProjectActivity{
			Value: &service.ProjectActivity_Milestone{Milestone: milestone},
		})
	}

	// Add tasks (populated with relationships)
	tasks := data.GetTasksByProjectID(req.ProjectId)
	for _, task := range tasks {
		activities = append(activities, &service.ProjectActivity{
			Value: &service.ProjectActivity_Task{Task: task},
		})
	}

	return &service.QueryProjectActivitiesResponse{ProjectActivities: activities}, nil
}

// QueryProjectResources implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectResources(ctx context.Context, req *service.QueryProjectResourcesRequest) (*service.QueryProjectResourcesResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var resources []*service.ProjectResource

	// Find the project
	var project *service.Project
	for _, p := range data.ServiceProjects {
		if p.Id == req.ProjectId {
			project = p
			break
		}
	}

	if project == nil {
		return nil, status.Errorf(codes.NotFound, "project not found")
	}

	// Get populated project to access relationships
	project = p.populateProjectRelationships(project)

	// Add employees (team members)
	for _, employee := range project.TeamMembers {
		resources = append(resources, &service.ProjectResource{
			Value: &service.ProjectResource_Employee{Employee: employee},
		})
	}

	// Add related products
	for _, product := range project.RelatedProducts {
		resources = append(resources, &service.ProjectResource{
			Value: &service.ProjectResource_Product{Product: product},
		})
	}

	// Add milestones
	for _, milestone := range project.Milestones {
		resources = append(resources, &service.ProjectResource{
			Value: &service.ProjectResource_Milestone{Milestone: milestone},
		})
	}

	// Add tasks
	for _, task := range project.Tasks {
		resources = append(resources, &service.ProjectResource{
			Value: &service.ProjectResource_Task{Task: task},
		})
	}

	return &service.QueryProjectResourcesResponse{ProjectResources: resources}, nil
}

// QuerySearchProjects implements projects.ProjectsServiceServer.
func (p *ProjectsService) QuerySearchProjects(ctx context.Context, req *service.QuerySearchProjectsRequest) (*service.QuerySearchProjectsResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var searchResults []*service.ProjectSearchResult
	query := strings.ToLower(req.Query)

	// Search projects
	for _, project := range data.ServiceProjects {
		if strings.Contains(strings.ToLower(project.Name), query) ||
			(project.Description != nil && strings.Contains(strings.ToLower(project.Description.Value), query)) {
			populatedProject := p.populateProjectRelationships(project)
			searchResults = append(searchResults, &service.ProjectSearchResult{
				Value: &service.ProjectSearchResult_Project{Project: populatedProject},
			})
		}
	}

	// Search milestones
	for _, milestone := range data.ServiceMilestones {
		if strings.Contains(strings.ToLower(milestone.Name), query) ||
			(milestone.Description != nil && strings.Contains(strings.ToLower(milestone.Description.Value), query)) {
			searchResults = append(searchResults, &service.ProjectSearchResult{
				Value: &service.ProjectSearchResult_Milestone{Milestone: milestone},
			})
		}
	}

	// Search tasks
	for _, task := range data.ServiceTasks {
		if strings.Contains(strings.ToLower(task.Name), query) ||
			(task.Description != nil && strings.Contains(strings.ToLower(task.Description.Value), query)) {
			searchResults = append(searchResults, &service.ProjectSearchResult{
				Value: &service.ProjectSearchResult_Task{Task: task},
			})
		}
	}

	return &service.QuerySearchProjectsResponse{SearchProjects: searchResults}, nil
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
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Employee

	// Maintain order of keys
	for _, key := range req.Keys {
		id, err := strconv.ParseInt(key.Id, 10, 32)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid employee id: %v", err)
		}

		found := false
		for _, employee := range data.Employees {
			if employee.Id == int32(id) {
				result = append(result, employee)
				found = true
				break
			}
		}
		if !found {
			result = append(result, nil)
		}
	}

	return &service.LookupEmployeeByIdResponse{Result: result}, nil
}

// LookupProjectById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupProjectById(ctx context.Context, req *service.LookupProjectByIdRequest) (*service.LookupProjectByIdResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Project

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, project := range data.ServiceProjects {
			if project.Id == key.Id {
				result = append(result, project)
				found = true
				break
			}
		}
		if !found {
			result = append(result, nil)
		}
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
		Id:              strconv.Itoa(nextID),
		Name:            req.Project.Name,
		Description:     req.Project.Description,
		Status:          req.Project.Status,
		StartDate:       req.Project.StartDate,
		EndDate:         req.Project.EndDate,
		TeamMembers:     []*service.Employee{},
		RelatedProducts: []*service.Product{},
		MilestoneIds:    []string{},
		Milestones:      []*service.Milestone{},
		Tasks:           []*service.Task{},
		Progress:        &wrapperspb.DoubleValue{Value: 0.0},
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
			return &service.QueryProjectResponse{Project: p.populateProjectRelationships(project)}, nil
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

	// Populate relationships for all projects
	var populatedProjects []*service.Project
	for _, project := range data.ServiceProjects {
		populatedProjects = append(populatedProjects, p.populateProjectRelationships(project))
	}

	return &service.QueryProjectsResponse{Projects: populatedProjects}, nil
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
