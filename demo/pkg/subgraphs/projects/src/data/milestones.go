package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceMilestones = []*projects.Milestone{
	{
		Id:                   "1",
		ProjectId:            "1",
		Name:                 "Infrastructure Assessment",
		Description:          new("Evaluate current infrastructure and plan migration"),
		StartDate:            new("2021-01-01"),
		EndDate:              new("2021-03-31"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: new(100.0),
		Dependencies:         []*projects.Milestone{},                                                                      // Will be populated dynamically
		Subtasks:             &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},             // Will be populated dynamically
		Reviewers:            &projects.ListOfEmployee{List: &projects.ListOfEmployee_List{Items: []*projects.Employee{}}}, // Will be populated dynamically
	},
	{
		Id:                   "2",
		ProjectId:            "1",
		Name:                 "Cloud Environment Setup",
		Description:          new("Set up AWS/Azure environments and networking"),
		StartDate:            new("2021-04-01"),
		EndDate:              new("2021-06-30"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: new(65.0),
		Dependencies:         []*projects.Milestone{},                                                                      // Will be populated dynamically
		Subtasks:             nil,                                                                                          // nullable list example - will be populated dynamically
		Reviewers:            &projects.ListOfEmployee{List: &projects.ListOfEmployee_List{Items: []*projects.Employee{}}}, // Will be populated dynamically
	},
	{
		Id:                   "3",
		ProjectId:            "1",
		Name:                 "Application Migration",
		Description:          new("Migrate applications to cloud infrastructure"),
		StartDate:            new("2021-07-01"),
		EndDate:              new("2025-08-20"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_PENDING,
		CompletionPercentage: new(25.0),
		Dependencies:         []*projects.Milestone{},                                                                      // Will be populated dynamically
		Subtasks:             &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},             // Will be populated dynamically
		Reviewers:            &projects.ListOfEmployee{List: &projects.ListOfEmployee_List{Items: []*projects.Employee{}}}, // Will be populated dynamically
	},
	{
		Id:                   "4",
		ProjectId:            "2",
		Name:                 "Service Decomposition",
		Description:          new("Analyze monolith and define service boundaries"),
		StartDate:            new("2021-01-01"),
		EndDate:              new("2021-04-30"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: new(100.0),
		Dependencies:         []*projects.Milestone{},                                                                      // Will be populated dynamically
		Subtasks:             &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{}}},             // Will be populated dynamically
		Reviewers:            &projects.ListOfEmployee{List: &projects.ListOfEmployee_List{Items: []*projects.Employee{}}}, // Will be populated dynamically
	},
	{
		Id:                   "5",
		ProjectId:            "2",
		Name:                 "API Gateway Implementation",
		Description:          new("Implement API gateway and service mesh"),
		StartDate:            new("2021-05-01"),
		EndDate:              new("2022-12-31"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: new(70.0),
	},
	{
		Id:                   "6",
		ProjectId:            "2",
		Name:                 "Service Deployment",
		Description:          new("Deploy and orchestrate microservices"),
		StartDate:            new("2023-01-01"),
		EndDate:              new("2025-08-20"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_PENDING,
		CompletionPercentage: new(45.0),
	},
	{
		Id:                   "7",
		ProjectId:            "6",
		Name:                 "UI/UX Research",
		Description:          new("Conduct user research and design new interfaces"),
		StartDate:            new("2022-01-01"),
		EndDate:              new("2022-06-30"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: new(100.0),
	},
	{
		Id:                   "8",
		ProjectId:            "6",
		Name:                 "Flutter Implementation",
		Description:          new("Implement new mobile apps using Flutter"),
		StartDate:            new("2022-07-01"),
		EndDate:              new("2023-01-31"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: new(100.0),
	},
	{
		Id:                   "9",
		ProjectId:            "7",
		Name:                 "Data Architecture Design",
		Description:          new("Design data lake architecture and data flow"),
		StartDate:            new("2023-01-01"),
		EndDate:              new("2023-06-30"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: new(100.0),
	},
	{
		Id:                   "10",
		ProjectId:            "7",
		Name:                 "Data Ingestion Pipeline",
		Description:          new("Build automated data ingestion and processing"),
		StartDate:            new("2023-07-01"),
		EndDate:              new("2024-12-31"),
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: new(30.0),
	},
}

// Helper function to get milestone dependencies
func GetMilestoneDependencies(milestoneID string) []*projects.Milestone {
	var dependencies []*projects.Milestone

	// Simple dependency logic for testing
	switch milestoneID {
	case "2": // Cloud Environment Setup depends on Infrastructure Assessment
		dep := GetMilestoneByID("1")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	case "3": // Application Migration depends on Cloud Environment Setup
		dep := GetMilestoneByID("2")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	case "5": // Microservice Architecture depends on Service Decomposition
		dep := GetMilestoneByID("4")
		if dep != nil {
			dependencies = append(dependencies, dep)
		}
	case "6": // API Development depends on Microservice Architecture
		dep := GetMilestoneByID("5")
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

// Helper function to get milestone subtasks
func GetMilestoneSubtasks(milestoneID string) *projects.ListOfTask {
	tasks := GetTasksByMilestoneID(milestoneID)

	// Return nil for some milestones to test nullable lists
	if milestoneID == "3" || milestoneID == "6" {
		return nil
	}

	// Add some nullable tasks for testing
	var subtasks []*projects.Task
	subtasks = append(subtasks, tasks...)

	// Add nil task for testing nullable items
	if len(subtasks) > 0 {
		subtasks = append(subtasks, nil)
	}

	return &projects.ListOfTask{List: &projects.ListOfTask_List{Items: subtasks}}
}

// Helper function to get milestone reviewers
func GetMilestoneReviewers(milestoneID string) *projects.ListOfEmployee {
	var reviewers []*projects.Employee

	// Assign reviewers based on milestone
	switch milestoneID {
	case "1", "2", "3": // Project 1 milestones
		reviewers = append(reviewers, GetEmployeeByID(1), GetEmployeeByID(2))
	case "4", "5", "6": // Project 2 milestones
		reviewers = append(reviewers, GetEmployeeByID(7), GetEmployeeByID(8))
	case "7", "8": // Project 6 milestones
		reviewers = append(reviewers, GetEmployeeByID(11))
	case "9", "10": // Project 7 milestones
		reviewers = append(reviewers, GetEmployeeByID(5), GetEmployeeByID(12))
	}

	return &projects.ListOfEmployee{List: &projects.ListOfEmployee_List{Items: reviewers}}
}

// Helper function to get milestone by ID
func GetMilestoneByID(id string) *projects.Milestone {
	for _, milestone := range ServiceMilestones {
		if milestone.Id == id {
			return milestone
		}
	}
	return nil
}

// Function to populate milestone with its relationships (call this dynamically, not during initialization)
func PopulateMilestoneRelationships(milestone *projects.Milestone) *projects.Milestone {
	populatedMilestone := &projects.Milestone{
		Id:                   milestone.Id,
		ProjectId:            milestone.ProjectId,
		Name:                 milestone.Name,
		Description:          milestone.Description,
		StartDate:            milestone.StartDate,
		EndDate:              milestone.EndDate,
		Status:               milestone.Status,
		CompletionPercentage: milestone.CompletionPercentage,
		// Populate the relationship fields dynamically
		Dependencies: GetMilestoneDependencies(milestone.Id),
		Subtasks:     GetMilestoneSubtasks(milestone.Id),
		Reviewers:    GetMilestoneReviewers(milestone.Id),
	}
	return populatedMilestone
}
