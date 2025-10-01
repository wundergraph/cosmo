package expr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRequestOperationBucketVisitor validates that expressions are correctly classified into buckets
// based on the attributes they access.
//
// Priority (low → high): Default < Auth < Sha256 < ParsingTime < NameOrType < PersistedId <
//	NormalizationTime < Hash < ValidationTime < PlanningTime < Subgraph

func TestRequestOperationBucketVisitor(t *testing.T) {
	tests := []struct {
		name           string
		expression     string
		expectedBucket AttributeBucket
		description    string
	}{
		// BucketDefault - no matching attributes
		{
			name:           "no operation attributes",
			expression:     `"static value"`,
			expectedBucket: BucketDefault,
			description:    "Expression with no request attributes should use default bucket",
		},
		{
			name:           "request without operation",
			expression:     `request.url.method == "POST"`,
			expectedBucket: BucketDefault,
			description:    "Request attributes other than operation should use default bucket",
		},

		// BucketAuth - request.auth (lowest priority operation attribute)
		{
			name:           "request.auth.claims",
			expression:     `request.auth.claims["sub"] == "user123"`,
			expectedBucket: BucketAuth,
			description:    "Auth claims access should use auth bucket",
		},
		{
			name:           "request.auth.scopes",
			expression:     `"admin" in request.auth.scopes`,
			expectedBucket: BucketAuth,
			description:    "Auth scopes access should use auth bucket",
		},
		{
			name:           "request.auth with string property",
			expression:     `request["auth"]["claims"]`,
			expectedBucket: BucketAuth,
			description:    "Auth access with bracket notation should use auth bucket",
		},

		// BucketSha256 - request.operation.sha256Hash
		{
			name:           "sha256Hash",
			expression:     `request.operation.sha256Hash == "abc123"`,
			expectedBucket: BucketSha256,
			description:    "SHA256 hash access should use sha256 bucket",
		},
		{
			name:           "sha256Hash with bracket notation",
			expression:     `request["operation"]["sha256Hash"]`,
			expectedBucket: BucketSha256,
			description:    "SHA256 hash with bracket notation should use sha256 bucket",
		},
		{
			name:           "sha256Hash in condition",
			expression:     `request.operation.sha256Hash != "" && request.url.method == "POST"`,
			expectedBucket: BucketSha256,
			description:    "SHA256 hash in complex condition should use sha256 bucket",
		},

		// BucketParsingTime - request.operation.parsingTime
		{
			name:           "parsingTime",
			expression:     `request.operation.parsingTime`,
			expectedBucket: BucketParsingTime,
			description:    "Parsing time access should use parsing time bucket",
		},
		{
			name:           "parsingTime with bracket",
			expression:     `request.operation["parsingTime"]`,
			expectedBucket: BucketParsingTime,
			description:    "Parsing time with bracket notation should use parsing time bucket",
		},

		// BucketNameOrType - request.operation.name or request.operation.type
		{
			name:           "operation name",
			expression:     `request.operation.name == "GetUser"`,
			expectedBucket: BucketNameOrType,
			description:    "Operation name access should use name/type bucket",
		},
		{
			name:           "operation type",
			expression:     `request.operation.type == "query"`,
			expectedBucket: BucketNameOrType,
			description:    "Operation type access should use name/type bucket",
		},
		{
			name:           "operation name in conditional",
			expression:     `request.operation.name != "" ? "named" : "anonymous"`,
			expectedBucket: BucketNameOrType,
			description:    "Operation name in ternary should use name/type bucket",
		},

		// BucketPersistedId - request.operation.persistedId
		{
			name:           "persistedId",
			expression:     `request.operation.persistedId == "abc123"`,
			expectedBucket: BucketPersistedId,
			description:    "Persisted ID access should use persisted ID bucket",
		},
		{
			name:           "persistedId existence check",
			expression:     `request.operation.persistedId != ""`,
			expectedBucket: BucketPersistedId,
			description:    "Persisted ID check should use persisted ID bucket",
		},

		// BucketNormalizationTime - request.operation.normalizationTime
		{
			name:           "normalizationTime",
			expression:     `request.operation.normalizationTime`,
			expectedBucket: BucketNormalizationTime,
			description:    "Normalization time access should use normalization time bucket",
		},
		{
			name:           "normalizationTime comparison",
			expression:     `request.operation.normalizationTime < request.operation.parsingTime`,
			expectedBucket: BucketNormalizationTime,
			description:    "Normalization time is higher priority than parsing time",
		},

		// BucketHash - request.operation.hash
		{
			name:           "operation hash",
			expression:     `request.operation.hash == "xyz789"`,
			expectedBucket: BucketHash,
			description:    "Operation hash access should use hash bucket",
		},
		{
			name:           "hash with bracket notation",
			expression:     `request["operation"]["hash"]`,
			expectedBucket: BucketHash,
			description:    "Hash with bracket notation should use hash bucket",
		},

		// BucketValidationTime - request.operation.validationTime
		{
			name:           "validationTime",
			expression:     `request.operation.validationTime`,
			expectedBucket: BucketValidationTime,
			description:    "Validation time access should use validation time bucket",
		},
		{
			name:           "validationTime vs hash priority",
			expression:     `request.operation.validationTime > request.operation.normalizationTime && request.operation.hash != ""`,
			expectedBucket: BucketValidationTime,
			description:    "Validation time is higher priority than hash",
		},

		// BucketPlanningTime - request.operation.planningTime
		{
			name:           "planningTime",
			expression:     `request.operation.planningTime`,
			expectedBucket: BucketPlanningTime,
			description:    "Planning time access should use planning time bucket",
		},
		{
			name:           "planningTime comparison",
			expression:     `request.operation.planningTime + request.operation.validationTime`,
			expectedBucket: BucketPlanningTime,
			description:    "Planning time is higher priority than validation time",
		},

		// BucketSubgraph - subgraph or subgraph.* (highest priority)
		{
			name:           "subgraph identifier",
			expression:     `subgraph`,
			expectedBucket: BucketSubgraph,
			description:    "Direct subgraph reference should use subgraph bucket",
		},
		{
			name:           "subgraph.name",
			expression:     `subgraph.name == "products"`,
			expectedBucket: BucketSubgraph,
			description:    "Subgraph property access should use subgraph bucket",
		},
		{
			name:           "subgraph in condition",
			expression:     `subgraph.name == "users" && request.url.method == "POST"`,
			expectedBucket: BucketSubgraph,
			description:    "Subgraph in condition should use subgraph bucket",
		},
		{
			name:           "subgraph vs all operation attributes",
			expression:     `subgraph.name + request.operation.hash + request.operation.name`,
			expectedBucket: BucketSubgraph,
			description:    "Subgraph is highest priority even with other attributes",
		},

		// Priority tests - multiple attributes with different priorities
		{
			name:           "auth and sha256 - sha256 wins",
			expression:     `request.auth.claims["sub"] == "user" && request.operation.sha256Hash == "abc"`,
			expectedBucket: BucketSha256,
			description:    "SHA256 should win over auth (higher priority)",
		},
		{
			name:           "sha256 and name - name wins",
			expression:     `request.operation.sha256Hash + request.operation.name`,
			expectedBucket: BucketNameOrType,
			description:    "Name should win over sha256 (higher priority)",
		},
		{
			name:           "name and persistedId - persistedId wins",
			expression:     `request.operation.name == "Query" && request.operation.persistedId != ""`,
			expectedBucket: BucketPersistedId,
			description:    "Persisted ID should win over name (higher priority)",
		},
		{
			name:           "persistedId and hash - hash wins",
			expression:     `request.operation.persistedId + request.operation.hash`,
			expectedBucket: BucketHash,
			description:    "Hash should win over persisted ID (higher priority)",
		},
		{
			name:           "hash and validationTime - validationTime wins",
			expression:     `request.operation.hash == "xyz" && request.operation.validationTime > request.operation.parsingTime`,
			expectedBucket: BucketValidationTime,
			description:    "Validation time should win over hash (higher priority)",
		},
		{
			name:           "validationTime and planningTime - planningTime wins",
			expression:     `request.operation.validationTime + request.operation.planningTime`,
			expectedBucket: BucketPlanningTime,
			description:    "Planning time should win over validation time (higher priority)",
		},
		{
			name:           "planningTime and subgraph - subgraph wins",
			expression:     `request.operation.planningTime > request.operation.validationTime && subgraph.name != ""`,
			expectedBucket: BucketSubgraph,
			description:    "Subgraph should win over planning time (highest priority)",
		},

		// Complex expressions
		{
			name:           "nested conditional with multiple attributes",
			expression:     `request.operation.type == "mutation" ? request.operation.name : request.auth.claims["sub"]`,
			expectedBucket: BucketNameOrType,
			description:    "Name/type should win in nested conditional with auth",
		},
		{
			name:           "complex boolean expression",
			expression:     `(request.operation.parsingTime > request.operation.validationTime) || (request.operation.planningTime > request.operation.parsingTime)`,
			expectedBucket: BucketPlanningTime,
			description:    "Planning time should be detected in complex boolean expression",
		},
		{
			name:           "string concatenation",
			expression:     `request.operation.name + "-" + request.operation.hash`,
			expectedBucket: BucketHash,
			description:    "Hash should win in string concatenation with name",
		},

		// Edge cases
		{
			name:           "operation without specific property",
			expression:     `request.operation`,
			expectedBucket: BucketDefault,
			description:    "Operation without property access should use default bucket",
		},
		{
			name:           "auth combined with non-operation",
			expression:     `request.auth.claims["role"] + request.url.method`,
			expectedBucket: BucketAuth,
			description:    "Auth with non-operation attributes should use auth bucket",
		},
		{
			name:           "mixed identifier and string property access",
			expression:     `request["operation"].sha256Hash`,
			expectedBucket: BucketSha256,
			description:    "Mixed bracket and dot notation should work for sha256",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a new expression manager
			exprManager := CreateNewExprManager()

			// Create the visitor
			visitor := &RequestOperationBucketVisitor{
				Bucket: BucketDefault,
			}

			// Compile the expression with the visitor
			_, err := exprManager.CompileAnyExpression(tt.expression, visitor)
			require.NoError(t, err, "Failed to compile expression: %s", tt.expression)

			// Assert the bucket matches expected
			assert.Equal(t, tt.expectedBucket, visitor.Bucket,
				"Description: %s\nExpression: %s\nExpected bucket: %v (priority %d)\nGot bucket: %v (priority %d)",
				tt.description, tt.expression, bucketName(tt.expectedBucket), tt.expectedBucket,
				bucketName(visitor.Bucket), visitor.Bucket)
		})
	}
}

// bucketName returns a human-readable name for the bucket (for better test output)
func bucketName(bucket AttributeBucket) string {
	switch bucket {
	case BucketDefault:
		return "BucketDefault"
	case BucketAuth:
		return "BucketAuth"
	case BucketSha256:
		return "BucketSha256"
	case BucketParsingTime:
		return "BucketParsingTime"
	case BucketNameOrType:
		return "BucketNameOrType"
	case BucketPersistedId:
		return "BucketPersistedId"
	case BucketNormalizationTime:
		return "BucketNormalizationTime"
	case BucketHash:
		return "BucketHash"
	case BucketValidationTime:
		return "BucketValidationTime"
	case BucketPlanningTime:
		return "BucketPlanningTime"
	case BucketSubgraph:
		return "BucketSubgraph"
	default:
		return "Unknown"
	}
}

// TestBucketPriority verifies the priority order is correct
func TestBucketPriority(t *testing.T) {
	// This test verifies the priority order defined in the constants
	// which would alert in case someone would change it

	assert.True(t, BucketDefault < BucketAuth, "Default should be lower priority than Auth")
	assert.True(t, BucketAuth < BucketSha256, "Auth should be lower priority than Sha256")
	assert.True(t, BucketSha256 < BucketParsingTime, "Sha256 should be lower priority than ParsingTime")
	assert.True(t, BucketParsingTime < BucketNameOrType, "ParsingTime should be lower priority than NameOrType")
	assert.True(t, BucketNameOrType < BucketPersistedId, "NameOrType should be lower priority than PersistedId")
	assert.True(t, BucketPersistedId < BucketNormalizationTime, "PersistedId should be lower priority than NormalizationTime")
	assert.True(t, BucketNormalizationTime < BucketHash, "NormalizationTime should be lower priority than Hash")
	assert.True(t, BucketHash < BucketValidationTime, "Hash should be lower priority than ValidationTime")
	assert.True(t, BucketValidationTime < BucketPlanningTime, "ValidationTime should be lower priority than PlanningTime")
	assert.True(t, BucketPlanningTime < BucketSubgraph, "PlanningTime should be lower priority than Subgraph")
}

// TestSetBucketIfHigher verifies the setBucketIfHigher logic
func TestSetBucketIfHigher(t *testing.T) {
	tests := []struct {
		name           string
		currentBucket  AttributeBucket
		newBucket      AttributeBucket
		expectedBucket AttributeBucket
	}{
		{
			name:           "lower priority should not update",
			currentBucket:  BucketHash,
			newBucket:      BucketSha256,
			expectedBucket: BucketHash,
		},
		{
			name:           "higher priority should update",
			currentBucket:  BucketSha256,
			newBucket:      BucketHash,
			expectedBucket: BucketHash,
		},
		{
			name:           "same priority should not update",
			currentBucket:  BucketHash,
			newBucket:      BucketHash,
			expectedBucket: BucketHash,
		},
		{
			name:           "subgraph should always win",
			currentBucket:  BucketPlanningTime,
			newBucket:      BucketSubgraph,
			expectedBucket: BucketSubgraph,
		},
		{
			name:           "nothing beats subgraph",
			currentBucket:  BucketSubgraph,
			newBucket:      BucketPlanningTime,
			expectedBucket: BucketSubgraph,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			visitor := &RequestOperationBucketVisitor{
				Bucket: tt.currentBucket,
			}
			visitor.setBucketIfHigher(tt.newBucket)
			assert.Equal(t, tt.expectedBucket, visitor.Bucket)
		})
	}
}
