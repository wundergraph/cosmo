package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ServiceProjects = []*projects.Project{
	{
		Id:              "1",
		Name:            "Cloud Migration Overhaul",
		Description:     &wrapperspb.StringValue{Value: "Migrate legacy systems to cloud-native architecture"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:       &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{}, // Will be resolved by GraphQL resolvers
		MilestoneIds:    []string{"1", "2", "3"},
		Milestones:      GetMilestonesByProjectID("1"),
		Tasks:           GetTasksByProjectID("1"),
		Progress:        &wrapperspb.DoubleValue{Value: 65.0},
	},
	{
		Id:              "2",
		Name:            "Microservices Revolution",
		Description:     &wrapperspb.StringValue{Value: "Break down monolith into microservices"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:       &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{"4", "5", "6"},
		Milestones:      GetMilestonesByProjectID("2"),
		Tasks:           GetTasksByProjectID("2"),
		Progress:        &wrapperspb.DoubleValue{Value: 75.0},
	},
	{
		Id:              "3",
		Name:            "AI-Powered Analytics",
		Description:     &wrapperspb.StringValue{Value: "Implement machine learning for business intelligence"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:       &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{},
		Milestones:      GetMilestonesByProjectID("3"),
		Tasks:           GetTasksByProjectID("3"),
		Progress:        &wrapperspb.DoubleValue{Value: 45.0},
	},
	{
		Id:              "4",
		Name:            "DevOps Transformation",
		Description:     &wrapperspb.StringValue{Value: "Implement CI/CD and infrastructure as code"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_PLANNING,
		StartDate:       &wrapperspb.StringValue{Value: "2023-03-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2024-12-31"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{},
		Milestones:      GetMilestonesByProjectID("4"),
		Tasks:           GetTasksByProjectID("4"),
		Progress:        &wrapperspb.DoubleValue{Value: 10.0},
	},
	{
		Id:              "5",
		Name:            "Security Overhaul",
		Description:     &wrapperspb.StringValue{Value: "Implement zero-trust security architecture"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_ON_HOLD,
		StartDate:       &wrapperspb.StringValue{Value: "2023-06-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2024-06-30"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{},
		Milestones:      GetMilestonesByProjectID("5"),
		Tasks:           GetTasksByProjectID("5"),
		Progress:        &wrapperspb.DoubleValue{Value: 5.0},
	},
	{
		Id:              "6",
		Name:            "Mobile App Redesign",
		Description:     &wrapperspb.StringValue{Value: "Modernize mobile applications with Flutter"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_COMPLETED,
		StartDate:       &wrapperspb.StringValue{Value: "2022-01-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2023-01-31"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{"7", "8"},
		Milestones:      GetMilestonesByProjectID("6"),
		Tasks:           GetTasksByProjectID("6"),
		Progress:        &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:              "7",
		Name:            "Data Lake Implementation",
		Description:     &wrapperspb.StringValue{Value: "Build enterprise data lake for analytics"},
		Status:          projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:       &wrapperspb.StringValue{Value: "2023-01-01"},
		EndDate:         &wrapperspb.StringValue{Value: "2024-12-31"},
		TeamMembers:     []*projects.Employee{},
		RelatedProducts: []*projects.Product{},
		MilestoneIds:    []string{"9", "10"},
		Milestones:      GetMilestonesByProjectID("7"),
		Tasks:           GetTasksByProjectID("7"),
		Progress:        &wrapperspb.DoubleValue{Value: 40.0},
	},
}

// Helper function to get project by ID
func GetProjectByID(id string) *projects.Project {
	for _, project := range ServiceProjects {
		if project.Id == id {
			return project
		}
	}
	return nil
}

// Helper function to get milestones by project ID
func GetMilestonesByProjectID(projectID string) []*projects.Milestone {
	var milestones []*projects.Milestone
	for _, milestone := range ServiceMilestones {
		if milestone.ProjectId == projectID {
			milestones = append(milestones, milestone)
		}
	}
	return milestones
}

// Helper function to get tasks by project ID
func GetTasksByProjectID(projectID string) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.ProjectId == projectID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get tasks by milestone ID
func GetTasksByMilestoneID(milestoneID string) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.MilestoneId != nil && task.MilestoneId.Value == milestoneID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get project updates by project ID
func GetProjectUpdatesByProjectID(projectID string) []*projects.ProjectUpdate {
	var updates []*projects.ProjectUpdate
	for _, update := range ServiceProjectUpdates {
		if update.ProjectId == projectID {
			updates = append(updates, update)
		}
	}
	return updates
}

func GetTeamMembersByProjectId(projectID string) []*projects.Employee {
	var teamMembers []*projects.Employee
	for _, employee := range Employees {
		for _, project := range employee.Projects {
			if project.Id == projectID {
				teamMembers = append(teamMembers, employee)
			}
		}
	}

	return teamMembers
}
