package service

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/hashicorp/go-hclog"
	service "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/data"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

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

// ResolveProjectSubProjects resolves the subProjects field for Project entities.
// It returns a list of child/sub-projects for each parent project context.
// The includeArchived argument controls whether completed (archived) projects are included.
// This field resolver supports recursive queries, allowing nested subProjects selections.
func (p *ProjectsService) ResolveProjectSubProjects(_ context.Context, req *service.ResolveProjectSubProjectsRequest) (*service.ResolveProjectSubProjectsResponse, error) {
	p.lock.RLock()
	defer p.lock.RUnlock()

	response := &service.ResolveProjectSubProjectsResponse{
		Result: make([]*service.ResolveProjectSubProjectsResult, 0, len(req.Context)),
	}

	// Check if archived projects should be included (defaults to true if not specified)
	includeArchived := true
	if req.FieldArgs != nil && req.FieldArgs.IncludeArchived != nil {
		includeArchived = req.FieldArgs.IncludeArchived.Value
	}

	// Define parent-to-subproject relationships using actual project IDs
	// This creates a hierarchy: 1 -> [2,3], 2 -> [4,5], 3 -> [6,7], etc.
	subProjectMapping := map[string][]string{
		"1": {"2", "3"},
		"2": {"4", "5"},
		"3": {"6", "7"},
		"4": {"1"},
		"5": {"2"},
		"6": {"3"},
		"7": {"4"},
	}

	for _, ctx := range req.Context {
		subProjects := make([]*service.Project, 0)

		// Get sub-project IDs for this parent project
		subProjectIDs, exists := subProjectMapping[ctx.Id]
		if !exists {
			// Default: return first two projects as sub-projects
			subProjectIDs = []string{"1", "2"}
		}

		for _, subProjectID := range subProjectIDs {
			project := data.GetProjectByID(subProjectID)
			if project == nil {
				continue
			}

			// Skip archived (completed) projects if not included
			if !includeArchived && project.Status == service.ProjectStatus_PROJECT_STATUS_COMPLETED {
				continue
			}

			// Populate relationships using the helper function
			subProjects = append(subProjects, p.populateProjectRelationships(project))
		}

		response.Result = append(response.Result, &service.ResolveProjectSubProjectsResult{
			SubProjects: subProjects,
		})
	}

	return response, nil
}
