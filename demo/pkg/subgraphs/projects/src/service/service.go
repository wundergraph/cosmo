package service

import (
	"context"
	"math"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hashicorp/go-hclog"
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

// ResolveProjectCriticalDeadline implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveProjectCriticalDeadline(_ context.Context, req *service.ResolveProjectCriticalDeadlineRequest) (*service.ResolveProjectCriticalDeadlineResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectCriticalDeadlineResponse{
		Result: make([]*service.ResolveProjectCriticalDeadlineResult, 0, len(req.Context)),
	}

	// Default to 30 days if not specified
	withinDays := 30
	if req.FieldArgs != nil && req.FieldArgs.WithinDays != nil {
		withinDays = int(req.FieldArgs.WithinDays.Value)
	}

	for _, context := range req.Context {
		var criticalDeadline *service.Timestamped

		// Get milestones for this project
		milestones := data.GetMilestonesByProjectID(context.Id)

		// Find the nearest upcoming deadline that's within the specified days
		var nearestMilestone *service.Milestone
		var nearestDays int = withinDays + 1 // Start with value beyond threshold

		now := time.Now()
		for _, milestone := range milestones {
			// Only consider incomplete milestones with an end date
			if milestone.Status == service.MilestoneStatus_MILESTONE_STATUS_COMPLETED {
				continue
			}

			if milestone.EndDate != nil {
				endDate, err := time.Parse("2006-01-02", milestone.EndDate.Value)
				if err == nil {
					daysUntil := int(math.Abs(endDate.Sub(now).Hours() / 24))
					// Check if it's within our window and closer than what we've found
					if daysUntil >= 0 && daysUntil <= withinDays && daysUntil < nearestDays {
						nearestDays = daysUntil
						nearestMilestone = milestone
					}
				}
			}
		}

		// If we found a critical milestone, return it
		if nearestMilestone != nil {
			criticalDeadline = &service.Timestamped{
				Instance: &service.Timestamped_Milestone{
					Milestone: data.PopulateMilestoneRelationships(nearestMilestone),
				},
			}
		} else {
			// Check if the project itself has a critical deadline
			if context.Status != service.ProjectStatus_PROJECT_STATUS_COMPLETED {
				project := data.GetProjectByID(context.Id)
				if project != nil && project.EndDate != nil {
					endDate, err := time.Parse("2006-01-02", project.EndDate.Value)
					if err == nil {
						daysUntil := int(math.Abs(endDate.Sub(now).Hours() / 24))
						if daysUntil >= 0 && daysUntil <= withinDays {
							criticalDeadline = &service.Timestamped{
								Instance: &service.Timestamped_Project{
									Project: p.populateProjectRelationships(project),
								},
							}
						}
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveProjectCriticalDeadlineResult{
			CriticalDeadline: criticalDeadline,
		})
	}

	return response, nil
}

// ResolveProjectTopPriorityItem implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveProjectTopPriorityItem(ctx context.Context, req *service.ResolveProjectTopPriorityItemRequest) (*service.ResolveProjectTopPriorityItemResponse, error) {
	logger := hclog.FromContext(ctx)

	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectTopPriorityItemResponse{
		Result: make([]*service.ResolveProjectTopPriorityItemResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		logger.Info("Processing context", "project_id", context.Id, "status", context.Status)
		var topPriorityItem *service.ProjectSearchResult

		// Filter by category if provided
		category := ""
		if req.FieldArgs != nil && req.FieldArgs.Category != nil {
			category = strings.ToLower(req.FieldArgs.Category.Value)
		}

		// Check for highest priority task if category allows
		if category == "" || category == "task" {
			// Get tasks for this project
			tasks := data.GetTasksByProjectID(context.Id)

			// Find the highest priority incomplete task
			var topTask *service.Task
			highestPriority := service.TaskPriority_TASK_PRIORITY_UNSPECIFIED

			for _, task := range tasks {
				// Skip completed tasks
				if task.Status == service.TaskStatus_TASK_STATUS_COMPLETED {
					continue
				}

				// Compare priorities (higher enum value = higher priority)
				if topTask == nil || task.Priority > highestPriority {
					highestPriority = task.Priority
					topTask = task
				}
			}

			if topTask != nil {
				topPriorityItem = &service.ProjectSearchResult{
					Value: &service.ProjectSearchResult_Task{
						Task: data.PopulateTaskRelationships(topTask),
					},
				}
			}
		}

		// If no task found and category allows, check for at-risk milestones
		if topPriorityItem == nil && (category == "" || category == "milestone") {
			milestones := data.GetMilestonesByProjectID(context.Id)
			for _, milestone := range milestones {
				if milestone.Status == service.MilestoneStatus_MILESTONE_STATUS_DELAYED ||
					milestone.Status == service.MilestoneStatus_MILESTONE_STATUS_PENDING {
					topPriorityItem = &service.ProjectSearchResult{
						Value: &service.ProjectSearchResult_Milestone{
							Milestone: data.PopulateMilestoneRelationships(milestone),
						},
					}
					break
				}
			}
		}

		// If still nothing found and category allows, return the project itself if it needs attention
		if topPriorityItem == nil && (category == "" || category == "project") {
			if context.Status == service.ProjectStatus_PROJECT_STATUS_ON_HOLD ||
				context.Status == service.ProjectStatus_PROJECT_STATUS_PLANNING {
				project := data.GetProjectByID(context.Id)
				if project != nil {
					topPriorityItem = &service.ProjectSearchResult{
						Value: &service.ProjectSearchResult_Project{
							Project: p.populateProjectRelationships(project),
						},
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveProjectTopPriorityItemResult{
			TopPriorityItem: topPriorityItem,
		})
	}

	return response, nil
}

// ResolveEmployeeAverageTaskCompletionDays implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveEmployeeAverageTaskCompletionDays(ctx context.Context, req *service.ResolveEmployeeAverageTaskCompletionDaysRequest) (*service.ResolveEmployeeAverageTaskCompletionDaysResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveEmployeeAverageTaskCompletionDaysResponse{
		Result: make([]*service.ResolveEmployeeAverageTaskCompletionDaysResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		employeeID := context.Id
		var totalDays float64
		var taskCount int

		// Find completed tasks for this employee
		for _, task := range data.ServiceTasks {
			if task.AssigneeId != nil && task.AssigneeId.Value == employeeID {
				// Filter by project if specified
				matchesProject := true
				if req.FieldArgs != nil && req.FieldArgs.ProjectId != nil {
					matchesProject = task.ProjectId == req.FieldArgs.ProjectId.Value
				}

				// Filter by priority if specified
				matchesPriority := true
				if req.FieldArgs != nil && req.FieldArgs.Priority != service.TaskPriority_TASK_PRIORITY_UNSPECIFIED {
					matchesPriority = task.Priority == req.FieldArgs.Priority
				}

				// Only count completed tasks with creation and completion dates
				if matchesProject && matchesPriority &&
					task.Status == service.TaskStatus_TASK_STATUS_COMPLETED &&
					task.CreatedAt != nil && task.CompletedAt != nil {
					createdAt, err1 := time.Parse(time.RFC3339, task.CreatedAt.Value)
					completedAt, err2 := time.Parse(time.RFC3339, task.CompletedAt.Value)
					if err1 == nil && err2 == nil {
						days := completedAt.Sub(createdAt).Hours() / 24
						totalDays += days
						taskCount++
					}
				}
			}
		}

		var averageDays *wrapperspb.DoubleValue
		if taskCount > 0 {
			averageDays = &wrapperspb.DoubleValue{Value: totalDays / float64(taskCount)}
		}

		response.Result = append(response.Result, &service.ResolveEmployeeAverageTaskCompletionDaysResult{
			AverageTaskCompletionDays: averageDays,
		})
	}

	return response, nil
}

// ResolveEmployeeCurrentWorkload implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveEmployeeCurrentWorkload(ctx context.Context, req *service.ResolveEmployeeCurrentWorkloadRequest) (*service.ResolveEmployeeCurrentWorkloadResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveEmployeeCurrentWorkloadResponse{
		Result: make([]*service.ResolveEmployeeCurrentWorkloadResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		employeeID := context.Id
		workloadCount := int32(0)

		// Count tasks assigned to this employee
		for _, task := range data.ServiceTasks {
			if task.AssigneeId != nil && task.AssigneeId.Value == employeeID {
				// Check if we should include completed tasks
				includeCompleted := false
				if req.FieldArgs != nil && req.FieldArgs.IncludeCompleted != nil {
					includeCompleted = req.FieldArgs.IncludeCompleted.Value
				}

				// Filter by project if specified
				matchesProject := true
				if req.FieldArgs != nil && req.FieldArgs.ProjectId != nil {
					matchesProject = task.ProjectId == req.FieldArgs.ProjectId.Value
				}

				if matchesProject {
					if includeCompleted || task.Status != service.TaskStatus_TASK_STATUS_COMPLETED {
						workloadCount++
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveEmployeeCurrentWorkloadResult{
			CurrentWorkload: workloadCount,
		})
	}

	return response, nil
}

// ResolveMilestoneDaysUntilDue implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveMilestoneDaysUntilDue(ctx context.Context, req *service.ResolveMilestoneDaysUntilDueRequest) (*service.ResolveMilestoneDaysUntilDueResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveMilestoneDaysUntilDueResponse{
		Result: make([]*service.ResolveMilestoneDaysUntilDueResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		// Use fromDate if provided, otherwise use current date
		fromDate := time.Now()
		if req.FieldArgs != nil && req.FieldArgs.FromDate != nil {
			parsedDate, err := time.Parse("2006-01-02", req.FieldArgs.FromDate.Value)
			if err == nil {
				fromDate = parsedDate
			}
		}

		var daysUntilDue *wrapperspb.Int32Value
		if context.EndDate != nil {
			endDate, err := time.Parse("2006-01-02", context.EndDate.Value)
			if err == nil {
				days := int32(endDate.Sub(fromDate).Hours() / 24)
				daysUntilDue = &wrapperspb.Int32Value{Value: days}
			}
		}

		response.Result = append(response.Result, &service.ResolveMilestoneDaysUntilDueResult{
			DaysUntilDue: daysUntilDue,
		})
	}

	return response, nil
}

// ResolveMilestoneIsAtRisk implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveMilestoneIsAtRisk(ctx context.Context, req *service.ResolveMilestoneIsAtRiskRequest) (*service.ResolveMilestoneIsAtRiskResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveMilestoneIsAtRiskResponse{
		Result: make([]*service.ResolveMilestoneIsAtRiskResult, 0, len(req.Context)),
	}

	// Default threshold is 70% - if completion is below this and status is not completed, it's at risk
	threshold := 70.0
	if req.FieldArgs != nil && req.FieldArgs.Threshold != nil {
		threshold = req.FieldArgs.Threshold.Value
	}

	for _, context := range req.Context {
		isAtRisk := false

		// Check if milestone is delayed or at risk
		if context.Status == service.MilestoneStatus_MILESTONE_STATUS_DELAYED {
			isAtRisk = true
		} else if context.Status != service.MilestoneStatus_MILESTONE_STATUS_COMPLETED {
			// Check if completion percentage is below threshold
			if context.CompletionPercentage != nil && context.CompletionPercentage.Value < threshold {
				// Also check if we're close to or past the end date
				if context.EndDate != nil {
					endDate, err := time.Parse("2006-01-02", context.EndDate.Value)
					if err == nil {
						daysUntilDue := time.Until(endDate).Hours() / 24
						// If less than 7 days remaining and not on track, it's at risk
						if daysUntilDue < 7 {
							isAtRisk = true
						}
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveMilestoneIsAtRiskResult{
			IsAtRisk: isAtRisk,
		})
	}

	return response, nil
}

// ResolveProjectCompletionRate implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveProjectCompletionRate(ctx context.Context, req *service.ResolveProjectCompletionRateRequest) (*service.ResolveProjectCompletionRateResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectCompletionRateResponse{
		Result: make([]*service.ResolveProjectCompletionRateResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		tasks := data.GetTasksByProjectID(context.Id)

		if len(tasks) == 0 {
			response.Result = append(response.Result, &service.ResolveProjectCompletionRateResult{
				CompletionRate: 0.0,
			})
			continue
		}

		completedCount := 0
		for _, task := range tasks {
			if task.Status == service.TaskStatus_TASK_STATUS_COMPLETED {
				completedCount++
			}
		}

		// If includeSubtasks is true, we could count subtasks too
		// For demo purposes, we'll just use the top-level tasks
		completionRate := float64(completedCount) / float64(len(tasks)) * 100.0

		response.Result = append(response.Result, &service.ResolveProjectCompletionRateResult{
			CompletionRate: completionRate,
		})
	}

	return response, nil
}

// ResolveProjectEstimatedDaysRemaining implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveProjectEstimatedDaysRemaining(ctx context.Context, req *service.ResolveProjectEstimatedDaysRemainingRequest) (*service.ResolveProjectEstimatedDaysRemainingResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectEstimatedDaysRemainingResponse{
		Result: make([]*service.ResolveProjectEstimatedDaysRemainingResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		// Use fromDate if provided, otherwise use current date
		fromDate := time.Now()
		if req.FieldArgs != nil && req.FieldArgs.FromDate != nil {
			parsedDate, err := time.Parse("2006-01-02", req.FieldArgs.FromDate.Value)
			if err == nil {
				fromDate = parsedDate
			}
		}

		var daysRemaining *wrapperspb.Int32Value
		if context.EndDate != nil {
			endDate, err := time.Parse("2006-01-02", context.EndDate.Value)
			if err == nil {
				days := int32(endDate.Sub(fromDate).Hours() / 24)
				daysRemaining = &wrapperspb.Int32Value{Value: days}
			}
		}

		response.Result = append(response.Result, &service.ResolveProjectEstimatedDaysRemainingResult{
			EstimatedDaysRemaining: daysRemaining,
		})
	}

	return response, nil
}

// ResolveProjectFilteredTasks implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveProjectFilteredTasks(ctx context.Context, req *service.ResolveProjectFilteredTasksRequest) (*service.ResolveProjectFilteredTasksResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectFilteredTasksResponse{
		Result: make([]*service.ResolveProjectFilteredTasksResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		tasks := data.GetTasksByProjectID(context.Id)

		// Filter by status if provided
		if req.FieldArgs != nil && req.FieldArgs.Status != service.TaskStatus_TASK_STATUS_UNSPECIFIED {
			filtered := make([]*service.Task, 0)
			for _, task := range tasks {
				if task.Status == req.FieldArgs.Status {
					filtered = append(filtered, task)
				}
			}
			tasks = filtered
		}

		// Filter by priority if provided
		if req.FieldArgs != nil && req.FieldArgs.Priority != service.TaskPriority_TASK_PRIORITY_UNSPECIFIED {
			filtered := make([]*service.Task, 0)
			for _, task := range tasks {
				if task.Priority == req.FieldArgs.Priority {
					filtered = append(filtered, task)
				}
			}
			tasks = filtered
		}

		// Apply limit if provided
		if req.FieldArgs != nil && req.FieldArgs.Limit != nil && req.FieldArgs.Limit.Value > 0 {
			limit := int(req.FieldArgs.Limit.Value)
			if len(tasks) > limit {
				tasks = tasks[:limit]
			}
		}

		// Populate tasks
		response.Result = append(response.Result, &service.ResolveProjectFilteredTasksResult{
			FilteredTasks: p.populateTasksList(tasks),
		})
	}

	return response, nil
}

// ResolveTaskIsBlocked implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveTaskIsBlocked(ctx context.Context, req *service.ResolveTaskIsBlockedRequest) (*service.ResolveTaskIsBlockedResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveTaskIsBlockedResponse{
		Result: make([]*service.ResolveTaskIsBlockedResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		isBlocked := false

		// Task is blocked if its status is BLOCKED
		if context.Status == service.TaskStatus_TASK_STATUS_BLOCKED {
			isBlocked = true
		}

		// If checkDependencies is true, also check if any dependencies are not completed
		if req.FieldArgs != nil && req.FieldArgs.CheckDependencies != nil && req.FieldArgs.CheckDependencies.Value {
			// For demo purposes, we'll check the task's dependencies field
			// In a real implementation, you'd look up the actual dependency tasks
			// and check their status
			task := data.GetTaskByID(context.Id)
			if task != nil && task.Dependencies != nil && len(task.Dependencies) > 0 {
				for _, dep := range task.Dependencies {
					if dep != nil && dep.Status != service.TaskStatus_TASK_STATUS_COMPLETED {
						isBlocked = true
						break
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveTaskIsBlockedResult{
			IsBlocked: isBlocked,
		})
	}

	return response, nil
}

// ResolveTaskTotalEffort implements projects.ProjectsServiceServer.
func (p *ProjectsService) ResolveTaskTotalEffort(ctx context.Context, req *service.ResolveTaskTotalEffortRequest) (*service.ResolveTaskTotalEffortResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveTaskTotalEffortResponse{
		Result: make([]*service.ResolveTaskTotalEffortResult, 0, len(req.Context)),
	}

	for _, context := range req.Context {
		var totalEffort *wrapperspb.DoubleValue

		// Calculate total effort as actual hours if available, otherwise estimated hours
		if context.ActualHours != nil {
			totalEffort = &wrapperspb.DoubleValue{Value: context.ActualHours.Value}
		} else if context.EstimatedHours != nil {
			totalEffort = &wrapperspb.DoubleValue{Value: context.EstimatedHours.Value}
		}

		// If includeSubtasks is true, add subtask effort
		if req.FieldArgs != nil && req.FieldArgs.IncludeSubtasks != nil && req.FieldArgs.IncludeSubtasks.Value {
			task := data.GetTaskByID(context.Id)
			if task != nil && task.Subtasks != nil && task.Subtasks.List != nil {
				for _, subtask := range task.Subtasks.List.Items {
					if subtask != nil {
						var subtaskEffort float64
						if subtask.ActualHours != nil {
							subtaskEffort = subtask.ActualHours.Value
						} else if subtask.EstimatedHours != nil {
							subtaskEffort = subtask.EstimatedHours.Value
						}
						if totalEffort == nil {
							totalEffort = &wrapperspb.DoubleValue{Value: subtaskEffort}
						} else {
							totalEffort.Value += subtaskEffort
						}
					}
				}
			}
		}

		response.Result = append(response.Result, &service.ResolveTaskTotalEffortResult{
			TotalEffort: totalEffort,
		})
	}

	return response, nil
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
		// Populate relationships with populated versions
		Milestones:      p.populateMilestonesList(data.GetMilestonesByProjectID(project.Id)),
		Tasks:           p.populateTasksList(data.GetTasksByProjectID(project.Id)),
		TeamMembers:     data.GetTeamMembersByProjectId(project.Id),
		RelatedProducts: p.getRelatedProductsByProjectId(project.Id),
		// Populate all new fields with helper functions
		Tags:                project.Tags, // Keep original tags
		AlternativeProjects: data.GetAlternativeProjects(project.Id),
		Dependencies:        data.GetProjectDependencies(project.Id),
		ResourceGroups:      data.GetResourceGroups(project.Id),
		TasksByPhase:        data.GetTasksByPhase(project.Id),
		MilestoneGroups:     data.GetMilestoneGroups(project.Id),
		PriorityMatrix:      data.GetPriorityMatrix(project.Id),
	}

	return populatedProject
}

// Helper function to populate a list of milestones with their relationships
func (p *ProjectsService) populateMilestonesList(milestones []*service.Milestone) []*service.Milestone {
	var populatedMilestones []*service.Milestone
	for _, milestone := range milestones {
		populatedMilestones = append(populatedMilestones, data.PopulateMilestoneRelationships(milestone))
	}
	return populatedMilestones
}

// Helper function to populate a list of tasks with their relationships
func (p *ProjectsService) populateTasksList(tasks []*service.Task) []*service.Task {
	var populatedTasks []*service.Task
	for _, task := range tasks {
		populatedTasks = append(populatedTasks, data.PopulateTaskRelationships(task))
	}
	return populatedTasks
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
	logger := hclog.FromContext(ctx)
	if len(req.Keys) == 0 {
		logger.Info("LookupMilestoneById", "no keys provided")
		return &service.LookupMilestoneByIdResponse{Result: []*service.Milestone{}}, nil
	}

	logger.Info("LookupMilestoneById", "milestone_id", req.Keys[0].Id)

	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Milestone

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, milestone := range data.ServiceMilestones {
			if milestone.Id == key.Id {
				// Populate the milestone with its relationships
				populatedMilestone := data.PopulateMilestoneRelationships(milestone)
				result = append(result, populatedMilestone)
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
	logger := hclog.FromContext(ctx)
	if len(req.Keys) == 0 {
		logger.Info("LookupTaskById", "no keys provided")
		return &service.LookupTaskByIdResponse{Result: []*service.Task{}}, nil
	}

	logger.Info("LookupTaskById", "task_id", req.Keys[0].Id)

	p.lock.RLock()
	defer p.lock.RUnlock()

	var result []*service.Task

	// Maintain order of keys
	for _, key := range req.Keys {
		found := false
		for _, task := range data.ServiceTasks {
			if task.Id == key.Id {
				// Populate the task with its relationships
				populatedTask := data.PopulateTaskRelationships(task)
				result = append(result, populatedTask)
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
	logger := hclog.FromContext(ctx)

	if len(req.Keys) == 0 {
		logger.Info("LookupProductByUpc", "no keys provided")
		return &service.LookupProductByUpcResponse{Result: []*service.Product{}}, nil
	}

	logger.Info("LookupProductByUpc", "upc", req.Keys[0].Upc)

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
	logger := hclog.FromContext(ctx)
	logger.Info("MutationAddMilestone", "project_id", req.Milestone.ProjectId)

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
	logger := hclog.FromContext(ctx)
	logger.Info("MutationAddTask", "project_id", req.Task.ProjectId)

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
	logger := hclog.FromContext(ctx)
	logger.Info("MutationUpdateProjectStatus", "project_id", req.ProjectId, "status", req.Status)

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
	logger := hclog.FromContext(ctx)
	logger.Info("QueryMilestones", "project_id", req.ProjectId)

	p.lock.RLock()
	defer p.lock.RUnlock()

	milestones := data.GetMilestonesByProjectID(req.ProjectId)
	// Populate relationships for all milestones
	populatedMilestones := p.populateMilestonesList(milestones)

	return &service.QueryMilestonesResponse{Milestones: populatedMilestones}, nil
}

// QueryTasks implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryTasks(ctx context.Context, req *service.QueryTasksRequest) (*service.QueryTasksResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryTasks", "project_id", req.ProjectId)

	p.lock.RLock()
	defer p.lock.RUnlock()

	tasks := data.GetTasksByProjectID(req.ProjectId)
	// Populate relationships for all tasks
	populatedTasks := p.populateTasksList(tasks)

	return &service.QueryTasksResponse{Tasks: populatedTasks}, nil
}

// QueryProjectActivities implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectActivities(ctx context.Context, req *service.QueryProjectActivitiesRequest) (*service.QueryProjectActivitiesResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjectActivities", "project_id", req.ProjectId)

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
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjectResources", "project_id", req.ProjectId)

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
	logger := hclog.FromContext(ctx)
	logger.Info("QuerySearchProjects", "query", req.Query)

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
	panic("The panic was triggered from QueryPanic")
}

// LookupEmployeeById implements projects.ProjectsServiceServer.
func (p *ProjectsService) LookupEmployeeById(ctx context.Context, req *service.LookupEmployeeByIdRequest) (*service.LookupEmployeeByIdResponse, error) {
	logger := hclog.FromContext(ctx)

	if len(req.Keys) == 0 {
		logger.Info("LookupEmployeeById", "no keys provided")
		return &service.LookupEmployeeByIdResponse{Result: []*service.Employee{}}, nil
	}

	logger.Info("LookupEmployeeById", "employee_id", req.Keys[0].Id)

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
	logger := hclog.FromContext(ctx)

	if len(req.Keys) == 0 {
		logger.Info("LookupProjectById", "no keys provided")
		return &service.LookupProjectByIdResponse{Result: []*service.Project{}}, nil
	}

	logger.Info("LookupProjectById", "project_id", req.Keys[0].Id)

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
	logger := hclog.FromContext(ctx)
	logger.Info("MutationAddProject")

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
		MilestoneIds:    &service.ListOfString{List: &service.ListOfString_List{Items: []string{}}},
		Milestones:      []*service.Milestone{},
		Tasks:           []*service.Task{},
		Progress:        &wrapperspb.DoubleValue{Value: 0.0},
	}

	data.ServiceProjects = append(data.ServiceProjects, project)

	return &service.MutationAddProjectResponse{AddProject: project}, nil
}

// QueryProject implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProject(ctx context.Context, req *service.QueryProjectRequest) (*service.QueryProjectResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProject", "project_id", req.Id)

	p.lock.RLock()
	defer p.lock.RUnlock()

	for _, project := range data.ServiceProjects {
		if project.Id == req.Id {
			return &service.QueryProjectResponse{Project: p.populateProjectRelationships(project)}, nil
		}
	}

	return nil, nil
}

// QueryProjectStatuses implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectStatuses(ctx context.Context, _ *service.QueryProjectStatusesRequest) (*service.QueryProjectStatusesResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjectStatuses")

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
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjects")

	p.lock.RLock()
	defer p.lock.RUnlock()

	// Populate relationships for all projects
	var populatedProjects []*service.Project
	for _, project := range data.ServiceProjects {
		populatedProjects = append(populatedProjects, p.populateProjectRelationships(project))
	}

	return &service.QueryProjectsResponse{Projects: populatedProjects}, nil
}

// QueryNodesById implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryNodesById(ctx context.Context, req *service.QueryNodesByIdRequest) (*service.QueryNodesByIdResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryNodesById", "id", req.Id)

	p.lock.RLock()
	defer p.lock.RUnlock()

	var nodes []*service.Node

	for _, project := range data.ServiceProjects {
		if project.Id == req.Id {
			nodes = append(nodes, &service.Node{
				Instance: &service.Node_Project{
					Project: p.populateProjectRelationships(project),
				},
			})
		}
	}
	for _, milestone := range data.ServiceMilestones {
		if milestone.Id == req.Id {
			nodes = append(nodes, &service.Node{
				Instance: &service.Node_Milestone{
					Milestone: data.PopulateMilestoneRelationships(milestone),
				},
			})
		}
	}
	for _, task := range data.ServiceTasks {
		if task.Id == req.Id {
			nodes = append(nodes, &service.Node{
				Instance: &service.Node_Task{
					Task: data.PopulateTaskRelationships(task),
				},
			})
		}
	}
	for _, update := range data.ServiceProjectUpdates {
		if update.Id == req.Id {
			nodes = append(nodes, &service.Node{
				Instance: &service.Node_ProjectUpdate{
					ProjectUpdate: p.populateProjectUpdateRelationships(update),
				},
			})
		}
	}

	return &service.QueryNodesByIdResponse{NodesById: nodes}, nil
}

// QueryProjectsByStatus implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectsByStatus(ctx context.Context, req *service.QueryProjectsByStatusRequest) (*service.QueryProjectsByStatusResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjectsByStatus", "status", req.Status)

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

// QueryProjectTags implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryProjectTags(ctx context.Context, req *service.QueryProjectTagsRequest) (*service.QueryProjectTagsResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryProjectTags")

	p.lock.RLock()
	defer p.lock.RUnlock()

	tags := data.GetAllProjectTags()
	return &service.QueryProjectTagsResponse{ProjectTags: tags}, nil
}

// QueryArchivedProjects implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryArchivedProjects(ctx context.Context, req *service.QueryArchivedProjectsRequest) (*service.QueryArchivedProjectsResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryArchivedProjects")

	p.lock.RLock()
	defer p.lock.RUnlock()

	archivedProjects := data.GetArchivedProjects()
	return &service.QueryArchivedProjectsResponse{ArchivedProjects: archivedProjects}, nil
}

// QueryTasksByPriority implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryTasksByPriority(ctx context.Context, req *service.QueryTasksByPriorityRequest) (*service.QueryTasksByPriorityResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryTasksByPriority", "project_id", req.ProjectId)

	p.lock.RLock()
	defer p.lock.RUnlock()

	tasks := data.GetTasksByProjectID(req.ProjectId)

	// Group tasks by priority - create nested lists
	lowTasks := []*service.Task{}
	mediumTasks := []*service.Task{}
	highTasks := []*service.Task{}
	urgentTasks := []*service.Task{}

	for _, task := range tasks {
		switch task.Priority {
		case service.TaskPriority_TASK_PRIORITY_LOW:
			lowTasks = append(lowTasks, task)
		case service.TaskPriority_TASK_PRIORITY_MEDIUM:
			mediumTasks = append(mediumTasks, task)
		case service.TaskPriority_TASK_PRIORITY_HIGH:
			highTasks = append(highTasks, task)
		case service.TaskPriority_TASK_PRIORITY_URGENT:
			urgentTasks = append(urgentTasks, task)
		}
	}

	// Create nested list structure for testing
	tasksByPriority := &service.ListOfListOfTask{
		List: &service.ListOfListOfTask_List{
			Items: []*service.ListOfTask{
				{List: &service.ListOfTask_List{Items: lowTasks}},
				{List: &service.ListOfTask_List{Items: mediumTasks}},
				{List: &service.ListOfTask_List{Items: highTasks}},
				{List: &service.ListOfTask_List{Items: urgentTasks}},
				{List: &service.ListOfTask_List{}}, // Empty list for testing
				nil,                                // Add nullable list for testing
			},
		},
	}

	return &service.QueryTasksByPriorityResponse{TasksByPriority: tasksByPriority}, nil
}

// QueryResourceMatrix implements projects.ProjectsServiceServer.
func (p *ProjectsService) QueryResourceMatrix(ctx context.Context, req *service.QueryResourceMatrixRequest) (*service.QueryResourceMatrixResponse, error) {
	logger := hclog.FromContext(ctx)
	logger.Info("QueryResourceMatrix", "project_id", req.ProjectId)

	p.lock.RLock()
	defer p.lock.RUnlock()

	// Create a matrix of resources grouped by type for testing
	var resourceMatrix []*service.ListOfProjectResource

	// Get project resources
	milestones := data.GetMilestonesByProjectID(req.ProjectId)
	tasks := data.GetTasksByProjectID(req.ProjectId)
	teamMembers := data.GetTeamMembersByProjectId(req.ProjectId)
	relatedProducts := p.getRelatedProductsByProjectId(req.ProjectId)

	// Group 1: Milestones as resources
	milestoneResources := []*service.ProjectResource{}
	for _, milestone := range milestones {
		milestoneResources = append(milestoneResources, &service.ProjectResource{
			Value: &service.ProjectResource_Milestone{Milestone: milestone},
		})
	}

	// Group 2: Tasks as resources
	taskResources := []*service.ProjectResource{}
	for _, task := range tasks {
		taskResources = append(taskResources, &service.ProjectResource{
			Value: &service.ProjectResource_Task{Task: task},
		})
	}

	// Group 3: Team members as resources
	employeeResources := []*service.ProjectResource{}
	for _, employee := range teamMembers {
		employeeResources = append(employeeResources, &service.ProjectResource{
			Value: &service.ProjectResource_Employee{Employee: employee},
		})
	}

	// Group 4: Products as resources
	productResources := []*service.ProjectResource{}
	for _, product := range relatedProducts {
		productResources = append(productResources, &service.ProjectResource{
			Value: &service.ProjectResource_Product{Product: product},
		})
	}

	resourceMatrix = []*service.ListOfProjectResource{
		{List: &service.ListOfProjectResource_List{Items: milestoneResources}},
		{List: &service.ListOfProjectResource_List{Items: taskResources}},
		{List: &service.ListOfProjectResource_List{Items: employeeResources}},
		{List: &service.ListOfProjectResource_List{Items: productResources}},
	}

	return &service.QueryResourceMatrixResponse{
		ResourceMatrix: &service.ListOfListOfProjectResource{
			List: &service.ListOfListOfProjectResource_List{Items: resourceMatrix},
		},
	}, nil
}
