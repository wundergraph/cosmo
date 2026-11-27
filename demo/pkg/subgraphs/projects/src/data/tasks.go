package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceTasks = []*projects.Task{
	{
		Id:             "1",
		ProjectId:      "1",
		MilestoneId:    new("1"),
		AssigneeId:     new(int32(1)),
		Name:           "Current Infrastructure Audit",
		Description:    new("Document existing servers, databases, and applications"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(40.0),
		ActualHours:    new(45.0),
		CreatedAt:      new("2021-01-01T00:00:00Z"),
		CompletedAt:    new("2021-01-15T17:30:00Z"),
		Labels:         &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"audit", "infrastructure", "high-priority"}}}, // nullable list of nullable labels
		Subtasks:       &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},                                       // nullable list of non-nullable subtasks
		Dependencies:   []*projects.Task{},                                                                                                     // non-nullable list of nullable tasks
		AttachmentUrls: []string{"https://docs.company.com/audit-report.pdf", "https://drive.company.com/infrastructure-map"},                  // non-nullable list of non-nullable URLs
		ReviewerIds:    &projects.ListOfInt{List: &projects.ListOfInt_List{Items: []int32{2, 3}}},                                              // nullable list of nullable reviewer IDs
	},
	{
		Id:             "2",
		ProjectId:      "1",
		MilestoneId:    new("1"),
		AssigneeId:     new(int32(2)),
		Name:           "Cloud Provider Selection",
		Description:    new("Evaluate AWS, Azure, and GCP options"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(24.0),
		ActualHours:    new(20.0),
		CreatedAt:      new("2021-01-16T00:00:00Z"),
		CompletedAt:    new("2021-02-28T16:00:00Z"),
		Labels:         nil,                                                     // nullable list example
		Subtasks:       &projects.ListOfTask{List: &projects.ListOfTask_List{}}, // null list example
		Dependencies:   []*projects.Task{},                                      // depends on task 1 (will be populated by helper)
		AttachmentUrls: []string{"https://docs.company.com/cloud-comparison.xlsx"},
		ReviewerIds:    &projects.ListOfInt{List: &projects.ListOfInt_List{Items: []int32{1, 4}}},
	},
	{
		Id:             "3",
		ProjectId:      "1",
		MilestoneId:    new("2"),
		AssigneeId:     new(int32(3)),
		Name:           "Network Setup",
		Description:    new("Configure VPCs, subnets, and security groups"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: new(32.0),
		ActualHours:    new(25.0),
		CreatedAt:      new("2021-04-01T00:00:00Z"),
		CompletedAt:    nil,
		Labels:         &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"networking", "cloud", "security"}}},
		Subtasks:       &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},
		Dependencies:   []*projects.Task{}, // depends on tasks 1 and 2
		AttachmentUrls: []string{},
		ReviewerIds:    &projects.ListOfInt{List: &projects.ListOfInt_List{Items: []int32{2}}},
	},
	{
		Id:             "4",
		ProjectId:      "2",
		MilestoneId:    new("4"),
		AssigneeId:     new(int32(7)),
		Name:           "Domain Model Analysis",
		Description:    new("Identify bounded contexts and service boundaries"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(50.0),
		ActualHours:    new(48.0),
		CreatedAt:      new("2021-01-01T00:00:00Z"),
		CompletedAt:    new("2021-03-15T18:00:00Z"),
	},
	{
		Id:             "5",
		ProjectId:      "2",
		MilestoneId:    new("5"),
		AssigneeId:     new(int32(8)),
		Name:           "API Gateway Configuration",
		Description:    new("Set up Kong or AWS API Gateway"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: new(30.0),
		ActualHours:    new(22.0),
		CreatedAt:      new("2021-05-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "6",
		ProjectId:      "3",
		Name:           "Machine Learning Model Research",
		Description:    new("Research and prototype ML models for business analytics"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: new(60.0),
		ActualHours:    new(35.0),
		CreatedAt:      new("2021-01-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "7",
		ProjectId:      "3",
		MilestoneId:    nil,
		AssigneeId:     new(int32(7)),
		Name:           "Data Pipeline Design",
		Description:    new("Design ETL pipelines for analytics data"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: new(45.0),
		ActualHours:    new(0.0),
		CreatedAt:      new("2021-02-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "8",
		ProjectId:      "4",
		MilestoneId:    nil,
		AssigneeId:     new(int32(1)),
		Name:           "CI/CD Pipeline Setup",
		Description:    new("Implement GitLab CI or GitHub Actions"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: new(35.0),
		ActualHours:    new(0.0),
		CreatedAt:      new("2023-03-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "9",
		ProjectId:      "5",
		MilestoneId:    nil,
		AssigneeId:     new(int32(2)),
		Name:           "Security Assessment",
		Description:    new("Conduct comprehensive security audit"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_URGENT,
		Status:         projects.TaskStatus_TASK_STATUS_BLOCKED,
		EstimatedHours: new(80.0),
		ActualHours:    new(10.0),
		CreatedAt:      new("2023-06-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "10",
		ProjectId:      "6",
		MilestoneId:    new("7"),
		AssigneeId:     new(int32(3)),
		Name:           "User Experience Testing",
		Description:    new("Conduct usability testing with focus groups"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(25.0),
		ActualHours:    new(28.0),
		CreatedAt:      new("2022-03-01T00:00:00Z"),
		CompletedAt:    new("2022-05-15T16:00:00Z"),
	},
	{
		Id:             "11",
		ProjectId:      "6",
		MilestoneId:    new("8"),
		AssigneeId:     new(int32(11)),
		Name:           "Flutter App Development",
		Description:    new("Develop cross-platform mobile application"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(120.0),
		ActualHours:    new(115.0),
		CreatedAt:      new("2022-07-01T00:00:00Z"),
		CompletedAt:    new("2022-12-20T17:30:00Z"),
	},
	{
		Id:             "12",
		ProjectId:      "7",
		MilestoneId:    new("9"),
		AssigneeId:     new(int32(5)),
		Name:           "Data Schema Design",
		Description:    new("Design schema for structured and unstructured data"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: new(40.0),
		ActualHours:    new(42.0),
		CreatedAt:      new("2023-01-15T00:00:00Z"),
		CompletedAt:    new("2023-04-10T18:00:00Z"),
	},
	{
		Id:             "13",
		ProjectId:      "7",
		MilestoneId:    new("10"),
		AssigneeId:     new(int32(12)),
		Name:           "Apache Spark Integration",
		Description:    new("Set up Spark clusters for data processing"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: new(55.0),
		ActualHours:    new(30.0),
		CreatedAt:      new("2023-08-01T00:00:00Z"),
		CompletedAt:    nil,
	},
	{
		Id:             "14",
		ProjectId:      "1",
		MilestoneId:    new("3"),
		AssigneeId:     new(int32(1)),
		Name:           "Database Migration",
		Description:    new("Migrate databases to cloud-managed services"),
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: new(65.0),
		ActualHours:    new(0.0),
		CreatedAt:      new("2021-07-01T00:00:00Z"),
		CompletedAt:    nil,
	},
}

// Helper function to get task dependencies
func GetTaskDependencies(taskID string) []*projects.Task {
	var dependencies []*projects.Task

	// Simple dependency logic for testing
	switch taskID {
	case "2": // Cloud Provider Selection depends on Infrastructure Audit
		dep := GetTaskByID("1")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	case "3": // Network Setup depends on both previous tasks
		dep1 := GetTaskByID("1")
		dep2 := GetTaskByID("2")
		if dep1 != nil {
			dependencies = append(dependencies, dep1)
		}
		if dep2 != nil {
			dependencies = append(dependencies, dep2)
		}
	case "5": // Container Platform depends on Network Setup
		dep := GetTaskByID("3")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	case "6": // Database Migration depends on Container Platform
		dep := GetTaskByID("5")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	}

	// Add nil for testing nullable items in non-nullable list
	if len(dependencies) > 0 {
		dependencies = append(dependencies, nil)
	}

	return dependencies
}

// Helper function to get task subtasks
func GetTaskSubtasks(taskID string) *projects.ListOfTask {
	// Return nil for some tasks to test nullable lists
	if taskID == "2" || taskID == "6" || taskID == "10" {
		return nil
	}

	// For testing, create some mock subtasks for specific tasks
	var subtasks []*projects.Task

	switch taskID {
	case "1": // Infrastructure Audit has subtasks
		subtasks = append(subtasks, &projects.Task{
			Id:          "1a",
			ProjectId:   "1",
			Name:        "Server Inventory",
			Description: new("Document all servers"),
			Priority:    projects.TaskPriority_TASK_PRIORITY_MEDIUM,
			Status:      projects.TaskStatus_TASK_STATUS_COMPLETED,
		})
		subtasks = append(subtasks, &projects.Task{
			Id:          "1b",
			ProjectId:   "1",
			Name:        "Database Inventory",
			Description: new("Document all databases"),
			Priority:    projects.TaskPriority_TASK_PRIORITY_MEDIUM,
			Status:      projects.TaskStatus_TASK_STATUS_COMPLETED,
		})
	case "3": // Network Setup has subtasks
		subtasks = append(subtasks, &projects.Task{
			Id:          "3a",
			ProjectId:   "1",
			Name:        "VPC Configuration",
			Description: new("Set up Virtual Private Cloud"),
			Priority:    projects.TaskPriority_TASK_PRIORITY_HIGH,
			Status:      projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		})
		subtasks = append(subtasks, &projects.Task{
			Id:          "3b",
			ProjectId:   "1",
			Name:        "Security Groups",
			Description: new("Configure security groups"),
			Priority:    projects.TaskPriority_TASK_PRIORITY_HIGH,
			Status:      projects.TaskStatus_TASK_STATUS_TODO,
		})
	}

	// Add nil subtask for testing nullable items
	if len(subtasks) > 0 {
		subtasks = append(subtasks, nil)
	}

	return &projects.ListOfTask{List: &projects.ListOfTask_List{Items: subtasks}}
}

// Helper function to get task by ID
func GetTaskByID(id string) *projects.Task {
	for _, task := range ServiceTasks {
		if task.Id == id {
			return task
		}
	}
	return nil
}

// Function to populate task with its relationships (call this dynamically, not during initialization)
func PopulateTaskRelationships(task *projects.Task) *projects.Task {
	populatedTask := &projects.Task{
		Id:             task.Id,
		ProjectId:      task.ProjectId,
		MilestoneId:    task.MilestoneId,
		AssigneeId:     task.AssigneeId,
		Name:           task.Name,
		Description:    task.Description,
		Priority:       task.Priority,
		Status:         task.Status,
		EstimatedHours: task.EstimatedHours,
		ActualHours:    task.ActualHours,
		CreatedAt:      task.CreatedAt,
		CompletedAt:    task.CompletedAt,
		// Keep original fields
		Labels:         task.Labels,
		AttachmentUrls: task.AttachmentUrls,
		ReviewerIds:    task.ReviewerIds,
		// Populate relationship fields dynamically
		Subtasks:     GetTaskSubtasks(task.Id),
		Dependencies: GetTaskDependencies(task.Id),
	}
	return populatedTask
}
