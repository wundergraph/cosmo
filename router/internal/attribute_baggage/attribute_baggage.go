package attribute_baggage

import (
	"context"
	"sync"
	"time"
)

const (
	OperationNameField           = "operation_name"
	OperationTypeField           = "operation_type"
	GraphQLErrorCodesField       = "graphql_error_codes"
	GraphQLErrorServicesField    = "graphql_error_service_names"
	OperationParsingTimeField    = "operation_parsing_time"
	OperationValidationTimeField = "operation_validation_time"
	OperationPlanningTimeField   = "operation_planning_time"
	OperationNormalizationField  = "operation_normalization"
)

var pool = sync.Pool{
	New: func() any {
		return &AttributeBaggage{
			StringAttributes:   make(map[string]string),
			SliceAttributes:    make(map[string][]string),
			DurationAttributes: make(map[string]time.Duration),
		}
	},
}

type attributeContextKey struct{}

// AttributeBaggage is a struct that holds information about the GraphQL operation request
// that is being executed. This information is used in different parts of the router to enrich the logs and metrics.
type AttributeBaggage struct {
	StringAttributes   map[string]string
	SliceAttributes    map[string][]string
	DurationAttributes map[string]time.Duration
}

func Get() *AttributeBaggage {
	return pool.Get().(*AttributeBaggage)
}

func Put(ab *AttributeBaggage) {
	ab.Reset()
	pool.Put(ab)
}

func (r *AttributeBaggage) AddDurationAttribute(name string, value time.Duration) {
	r.DurationAttributes[name] = value
}

func (r *AttributeBaggage) Reset() {
	r.StringAttributes = make(map[string]string)
	r.SliceAttributes = make(map[string][]string)
	r.DurationAttributes = make(map[string]time.Duration)
}

func (r *AttributeBaggage) AddStringAttribute(name, value string) {
	if r.StringAttributes == nil {
		r.StringAttributes = make(map[string]string)
	}
	r.StringAttributes[name] = value
}

func (r *AttributeBaggage) AddSliceAttribute(name string, values ...string) {
	if _, ok := r.SliceAttributes[name]; !ok {
		r.SliceAttributes[name] = make([]string, 0, len(values))
	}
	r.SliceAttributes[name] = append(r.SliceAttributes[name], values...)
}

func WithAttributeContext(ctx context.Context, ac *AttributeBaggage) context.Context {
	return context.WithValue(ctx, attributeContextKey{}, ac)
}

func GetAttributeContext(ctx context.Context) *AttributeBaggage {
	ac, _ := ctx.Value(attributeContextKey{}).(*AttributeBaggage)
	return ac
}
