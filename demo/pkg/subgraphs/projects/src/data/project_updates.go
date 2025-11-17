package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ServiceProjectUpdates = []*projects.ProjectUpdate{
	{
		Id:          "1",
		ProjectId:   "1",
		UpdatedById: 1, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_STATUS_CHANGE,
		Description: "Project status changed from PLANNING to ACTIVE",
		Timestamp:   "2021-01-01T09:00:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_status": "PLANNING", "new_status": "ACTIVE"}`},
	},
	{
		Id:          "2",
		ProjectId:   "1",
		UpdatedById: 2, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_MILESTONE_ADDED,
		Description: "Added milestone: Infrastructure Assessment",
		Timestamp:   "2021-01-02T10:30:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"milestone_id": "1", "milestone_name": "Infrastructure Assessment"}`},
	},
	{
		Id:          "3",
		ProjectId:   "2",
		UpdatedById: 7, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_TASK_ASSIGNED,
		Description: "Task assigned: Domain Model Analysis to employee #7",
		Timestamp:   "2021-01-01T11:15:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"task_id": "4", "assignee_id": "7"}`},
	},
	{
		Id:          "4",
		ProjectId:   "3",
		UpdatedById: 5, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_PROGRESS_UPDATE,
		Description: "Project progress updated to 45%",
		Timestamp:   "2021-06-15T14:20:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_progress": "30", "new_progress": "45"}`},
	},
	{
		Id:          "5",
		ProjectId:   "4",
		UpdatedById: 1, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_STATUS_CHANGE,
		Description: "Project moved to PLANNING phase",
		Timestamp:   "2023-03-01T08:00:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_status": "DRAFT", "new_status": "PLANNING"}`},
	},
	{
		Id:          "6",
		ProjectId:   "5",
		UpdatedById: 2, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_STATUS_CHANGE,
		Description: "Project put ON_HOLD due to security concerns",
		Timestamp:   "2023-06-15T16:45:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_status": "ACTIVE", "new_status": "ON_HOLD", "reason": "security_concerns"}`},
	},
	{
		Id:          "7",
		ProjectId:   "6",
		UpdatedById: 3, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_STATUS_CHANGE,
		Description: "Mobile App Redesign project completed successfully",
		Timestamp:   "2023-01-31T17:30:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_status": "ACTIVE", "new_status": "COMPLETED"}`},
	},
	{
		Id:          "8",
		ProjectId:   "7",
		UpdatedById: 5, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_TEAM_CHANGE,
		Description: "Added new team member to Data Lake Implementation",
		Timestamp:   "2023-02-15T10:00:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"action": "add", "employee_id": "12", "role": "data_engineer"}`},
	},
	{
		Id:          "9",
		ProjectId:   "2",
		UpdatedById: 8, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_PROGRESS_UPDATE,
		Description: "Microservices Revolution reached 75% completion",
		Timestamp:   "2024-01-10T13:25:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"old_progress": "70", "new_progress": "75"}`},
	},
	{
		Id:          "10",
		ProjectId:   "1",
		UpdatedById: 3, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_MILESTONE_ADDED,
		Description: "Added milestone: Application Migration",
		Timestamp:   "2021-06-30T15:00:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"milestone_id": "3", "milestone_name": "Application Migration"}`},
	},
	{
		Id:          "11",
		ProjectId:   "7",
		UpdatedById: 12, // Employee ID reference
		UpdateType:  projects.ProjectUpdateType_PROJECT_UPDATE_TYPE_TASK_ASSIGNED,
		Description: "Task assigned: Apache Spark Integration to employee #12",
		Timestamp:   "2023-08-01T09:30:00Z",
		Metadata:    &wrapperspb.StringValue{Value: `{"task_id": "13", "assignee_id": "12"}`},
	},
}

// Helper function to get project update by ID
func GetProjectUpdateById(id string) *projects.ProjectUpdate {
	for _, update := range ServiceProjectUpdates {
		if update.Id == id {
			return update
		}
	}
	return nil
}
