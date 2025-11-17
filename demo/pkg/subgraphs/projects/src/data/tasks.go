package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ServiceTasks = []*projects.Task{
	{
		Id:             "1",
		ProjectId:      "1",
		MilestoneId:    &wrapperspb.StringValue{Value: "1"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 1},
		Name:           "Current Infrastructure Audit",
		Description:    &wrapperspb.StringValue{Value: "Document existing servers, databases, and applications"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 40.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 45.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-01-01T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2021-01-15T17:30:00Z"},
		Labels:         &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"audit", "infrastructure", "high-priority"}}}, // nullable list of nullable labels
		Subtasks:       &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},                                       // nullable list of non-nullable subtasks
		Dependencies:   []*projects.Task{},                                                                                                     // non-nullable list of nullable tasks
		AttachmentUrls: []string{"https://docs.company.com/audit-report.pdf", "https://drive.company.com/infrastructure-map"},                  // non-nullable list of non-nullable URLs
		ReviewerIds:    &projects.ListOfInt{List: &projects.ListOfInt_List{Items: []int32{2, 3}}},                                              // nullable list of nullable reviewer IDs
	},
	{
		Id:             "2",
		ProjectId:      "1",
		MilestoneId:    &wrapperspb.StringValue{Value: "1"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 2},
		Name:           "Cloud Provider Selection",
		Description:    &wrapperspb.StringValue{Value: "Evaluate AWS, Azure, and GCP options"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 24.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 20.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-01-16T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2021-02-28T16:00:00Z"},
		Labels:         nil,                                                     // nullable list example
		Subtasks:       &projects.ListOfTask{List: &projects.ListOfTask_List{}}, // null list example
		Dependencies:   []*projects.Task{},                                      // depends on task 1 (will be populated by helper)
		AttachmentUrls: []string{"https://docs.company.com/cloud-comparison.xlsx"},
		ReviewerIds:    &projects.ListOfInt{List: &projects.ListOfInt_List{Items: []int32{1, 4}}},
	},
	{
		Id:             "3",
		ProjectId:      "1",
		MilestoneId:    &wrapperspb.StringValue{Value: "2"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 3},
		Name:           "Network Setup",
		Description:    &wrapperspb.StringValue{Value: "Configure VPCs, subnets, and security groups"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 32.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 25.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-04-01T00:00:00Z"},
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
		MilestoneId:    &wrapperspb.StringValue{Value: "4"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 7},
		Name:           "Domain Model Analysis",
		Description:    &wrapperspb.StringValue{Value: "Identify bounded contexts and service boundaries"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 50.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 48.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-01-01T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2021-03-15T18:00:00Z"},
	},
	{
		Id:             "5",
		ProjectId:      "2",
		MilestoneId:    &wrapperspb.StringValue{Value: "5"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 8},
		Name:           "API Gateway Configuration",
		Description:    &wrapperspb.StringValue{Value: "Set up Kong or AWS API Gateway"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 30.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 22.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-05-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "6",
		ProjectId:      "3",
		Name:           "Machine Learning Model Research",
		Description:    &wrapperspb.StringValue{Value: "Research and prototype ML models for business analytics"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 60.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 35.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-01-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "7",
		ProjectId:      "3",
		MilestoneId:    nil,
		AssigneeId:     &wrapperspb.Int32Value{Value: 7},
		Name:           "Data Pipeline Design",
		Description:    &wrapperspb.StringValue{Value: "Design ETL pipelines for analytics data"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 45.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 0.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-02-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "8",
		ProjectId:      "4",
		MilestoneId:    nil,
		AssigneeId:     &wrapperspb.Int32Value{Value: 1},
		Name:           "CI/CD Pipeline Setup",
		Description:    &wrapperspb.StringValue{Value: "Implement GitLab CI or GitHub Actions"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 35.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 0.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2023-03-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "9",
		ProjectId:      "5",
		MilestoneId:    nil,
		AssigneeId:     &wrapperspb.Int32Value{Value: 2},
		Name:           "Security Assessment",
		Description:    &wrapperspb.StringValue{Value: "Conduct comprehensive security audit"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_URGENT,
		Status:         projects.TaskStatus_TASK_STATUS_BLOCKED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 80.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 10.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2023-06-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "10",
		ProjectId:      "6",
		MilestoneId:    &wrapperspb.StringValue{Value: "7"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 3},
		Name:           "User Experience Testing",
		Description:    &wrapperspb.StringValue{Value: "Conduct usability testing with focus groups"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 25.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 28.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2022-03-01T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2022-05-15T16:00:00Z"},
	},
	{
		Id:             "11",
		ProjectId:      "6",
		MilestoneId:    &wrapperspb.StringValue{Value: "8"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 11},
		Name:           "Flutter App Development",
		Description:    &wrapperspb.StringValue{Value: "Develop cross-platform mobile application"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 120.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 115.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2022-07-01T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2022-12-20T17:30:00Z"},
	},
	{
		Id:             "12",
		ProjectId:      "7",
		MilestoneId:    &wrapperspb.StringValue{Value: "9"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 5},
		Name:           "Data Schema Design",
		Description:    &wrapperspb.StringValue{Value: "Design schema for structured and unstructured data"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_COMPLETED,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 40.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 42.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2023-01-15T00:00:00Z"},
		CompletedAt:    &wrapperspb.StringValue{Value: "2023-04-10T18:00:00Z"},
	},
	{
		Id:             "13",
		ProjectId:      "7",
		MilestoneId:    &wrapperspb.StringValue{Value: "10"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 12},
		Name:           "Apache Spark Integration",
		Description:    &wrapperspb.StringValue{Value: "Set up Spark clusters for data processing"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_MEDIUM,
		Status:         projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 55.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 30.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2023-08-01T00:00:00Z"},
		CompletedAt:    nil,
	},
	{
		Id:             "14",
		ProjectId:      "1",
		MilestoneId:    &wrapperspb.StringValue{Value: "3"},
		AssigneeId:     &wrapperspb.Int32Value{Value: 1},
		Name:           "Database Migration",
		Description:    &wrapperspb.StringValue{Value: "Migrate databases to cloud-managed services"},
		Priority:       projects.TaskPriority_TASK_PRIORITY_HIGH,
		Status:         projects.TaskStatus_TASK_STATUS_TODO,
		EstimatedHours: &wrapperspb.DoubleValue{Value: 65.0},
		ActualHours:    &wrapperspb.DoubleValue{Value: 0.0},
		CreatedAt:      &wrapperspb.StringValue{Value: "2021-07-01T00:00:00Z"},
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
			Description: &wrapperspb.StringValue{Value: "Document all servers"},
			Priority:    projects.TaskPriority_TASK_PRIORITY_MEDIUM,
			Status:      projects.TaskStatus_TASK_STATUS_COMPLETED,
		})
		subtasks = append(subtasks, &projects.Task{
			Id:          "1b",
			ProjectId:   "1",
			Name:        "Database Inventory",
			Description: &wrapperspb.StringValue{Value: "Document all databases"},
			Priority:    projects.TaskPriority_TASK_PRIORITY_MEDIUM,
			Status:      projects.TaskStatus_TASK_STATUS_COMPLETED,
		})
	case "3": // Network Setup has subtasks
		subtasks = append(subtasks, &projects.Task{
			Id:          "3a",
			ProjectId:   "1",
			Name:        "VPC Configuration",
			Description: &wrapperspb.StringValue{Value: "Set up Virtual Private Cloud"},
			Priority:    projects.TaskPriority_TASK_PRIORITY_HIGH,
			Status:      projects.TaskStatus_TASK_STATUS_IN_PROGRESS,
		})
		subtasks = append(subtasks, &projects.Task{
			Id:          "3b",
			ProjectId:   "1",
			Name:        "Security Groups",
			Description: &wrapperspb.StringValue{Value: "Configure security groups"},
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
