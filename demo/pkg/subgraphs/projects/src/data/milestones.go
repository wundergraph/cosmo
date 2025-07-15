package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ServiceMilestones = []*projects.Milestone{
	{
		Id:                   "1",
		ProjectId:            "1",
		Name:                 "Infrastructure Assessment",
		Description:          &wrapperspb.StringValue{Value: "Evaluate current infrastructure and plan migration"},
		StartDate:            &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2021-03-31"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:                   "2",
		ProjectId:            "1",
		Name:                 "Cloud Environment Setup",
		Description:          &wrapperspb.StringValue{Value: "Set up AWS/Azure environments and networking"},
		StartDate:            &wrapperspb.StringValue{Value: "2021-04-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2021-06-30"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 65.0},
	},
	{
		Id:                   "3",
		ProjectId:            "1",
		Name:                 "Application Migration",
		Description:          &wrapperspb.StringValue{Value: "Migrate applications to cloud infrastructure"},
		StartDate:            &wrapperspb.StringValue{Value: "2021-07-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2025-08-20"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_PENDING,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 25.0},
	},
	{
		Id:                   "4",
		ProjectId:            "2",
		Name:                 "Service Decomposition",
		Description:          &wrapperspb.StringValue{Value: "Analyze monolith and define service boundaries"},
		StartDate:            &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2021-04-30"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:                   "5",
		ProjectId:            "2",
		Name:                 "API Gateway Implementation",
		Description:          &wrapperspb.StringValue{Value: "Implement API gateway and service mesh"},
		StartDate:            &wrapperspb.StringValue{Value: "2021-05-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2022-12-31"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 70.0},
	},
	{
		Id:                   "6",
		ProjectId:            "2",
		Name:                 "Service Deployment",
		Description:          &wrapperspb.StringValue{Value: "Deploy and orchestrate microservices"},
		StartDate:            &wrapperspb.StringValue{Value: "2023-01-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2025-08-20"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_PENDING,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 45.0},
	},
	{
		Id:                   "7",
		ProjectId:            "6",
		Name:                 "UI/UX Research",
		Description:          &wrapperspb.StringValue{Value: "Conduct user research and design new interfaces"},
		StartDate:            &wrapperspb.StringValue{Value: "2022-01-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2022-06-30"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:                   "8",
		ProjectId:            "6",
		Name:                 "Flutter Implementation",
		Description:          &wrapperspb.StringValue{Value: "Implement new mobile apps using Flutter"},
		StartDate:            &wrapperspb.StringValue{Value: "2022-07-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2023-01-31"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:                   "9",
		ProjectId:            "7",
		Name:                 "Data Architecture Design",
		Description:          &wrapperspb.StringValue{Value: "Design data lake architecture and data flow"},
		StartDate:            &wrapperspb.StringValue{Value: "2023-01-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2023-06-30"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 100.0},
	},
	{
		Id:                   "10",
		ProjectId:            "7",
		Name:                 "Data Ingestion Pipeline",
		Description:          &wrapperspb.StringValue{Value: "Build automated data ingestion and processing"},
		StartDate:            &wrapperspb.StringValue{Value: "2023-07-01"},
		EndDate:              &wrapperspb.StringValue{Value: "2024-12-31"},
		Status:               projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS,
		CompletionPercentage: &wrapperspb.DoubleValue{Value: 30.0},
	},
}

// Helper function to get milestone by ID
func GetMilestoneById(id string) *projects.Milestone {
	for _, milestone := range ServiceMilestones {
		if milestone.Id == id {
			return milestone
		}
	}
	return nil
}
