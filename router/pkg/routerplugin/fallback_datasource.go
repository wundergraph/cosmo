// Package routerplugin provides implementations for router plugins and fallback mechanisms.
package routerplugin

import (
	"bytes"
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var _ plan.PlannerFactory[graphql_datasource.Configuration] = &FallbackFactory{}

// FallbackFactory implements plan.PlannerFactory to provide a fallback mechanism
// when plugins are disabled. It ensures proper error responses are returned
// through the resolver configuration.
type FallbackFactory struct{}

// Context implements plan.PlannerFactory.
func (d *FallbackFactory) Context() context.Context {
	return context.TODO()
}

// Planner implements plan.PlannerFactory.
func (d *FallbackFactory) Planner(logger abstractlogger.Logger) plan.DataSourcePlanner[graphql_datasource.Configuration] {
	return &disabledPluginPlanner{}
}

// UpstreamSchema implements plan.PlannerFactory.
func (d *FallbackFactory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[graphql_datasource.Configuration]) (*ast.Document, bool) {
	return dataSourceConfig.UpstreamSchema()
}

var _ plan.DataSourcePlanner[graphql_datasource.Configuration] = &disabledPluginPlanner{}

// disabledPluginPlanner implements plan.DataSourcePlanner to handle cases where
// plugins are disabled. It provides a minimal implementation that returns
// appropriate error responses.
type disabledPluginPlanner struct {
	id int
}

// ConfigureFetch implements plan.DataSourcePlanner to set up a disabled plugin
// data source that returns error responses.
func (d *disabledPluginPlanner) ConfigureFetch() resolve.FetchConfiguration {
	return resolve.FetchConfiguration{
		DataSource:     &disabledPluginDataSource{},
		PostProcessing: graphql_datasource.DefaultPostProcessingConfiguration,
	}
}

// ConfigureSubscription implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) ConfigureSubscription() plan.SubscriptionConfiguration {
	return plan.SubscriptionConfiguration{}
}

// DataSourcePlanningBehavior implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      true,
		OverrideFieldPathFromAlias: true,
		IncludeTypeNameFields:      true,
	}
}

// DownstreamResponseFieldAlias implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) DownstreamResponseFieldAlias(_ int) (alias string, exists bool) {
	return "", false
}

// ID implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) ID() int {
	return d.id
}

// Register implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) Register(_ *plan.Visitor, _ plan.DataSourceConfiguration[graphql_datasource.Configuration], _ plan.DataSourcePlannerConfiguration) error {
	return nil
}

// SetID implements plan.DataSourcePlanner.
func (d *disabledPluginPlanner) SetID(id int) {
	d.id = id
}

// disabledPluginDataSource implements the data source interface for disabled plugins.
// It returns a standardized error response indicating that the plugin is disabled.
type disabledPluginDataSource struct{}

// Load implements the data source interface to return an error response when
// plugins are disabled.
func (d *disabledPluginDataSource) Load(_ context.Context, _ []byte, out *bytes.Buffer) (err error) {
	out.WriteString(`{"errors":[{"message":"Plugin is disabled"}]}`)
	return nil
}

// LoadWithFiles implements the data source interface to return an error response
// when plugins are disabled, handling cases with file uploads.
func (d *disabledPluginDataSource) LoadWithFiles(_ context.Context, _ []byte, _ []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	out.WriteString(`{"errors":[{"message":"Plugin is disabled"}]}`)
	return nil
}
