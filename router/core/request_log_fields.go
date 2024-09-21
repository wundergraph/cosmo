package core

// Log fields for the request log.
const (
	OperationNameLogField              = "operation_name"
	OperationHashLogField              = "operation_hash"
	OperationTypeLogField              = "operation_type"
	GraphQLErrorCodesLogField          = "graphql_error_codes"
	GraphQLErrorServicesLogField       = "graphql_error_service_names"
	OperationParsingTimeLogField       = "operation_parsing_time"
	OperationValidationTimeLogField    = "operation_validation_time"
	OperationPlanningTimeLogField      = "operation_planning_time"
	OperationNormalizationTimeLogField = "operation_normalization_time"
	PersistedOperationSha256LogField   = "persisted_operation_sha256"
)
