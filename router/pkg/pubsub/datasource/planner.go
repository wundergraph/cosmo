package datasource

import (
	"fmt"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/eventdata"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/argument_templates"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type Planner[PB ProviderBuilder[P, E], P any, E any] struct {
	id           int
	config       *PlannerConfig[PB, P, E]
	rootFieldRef int
	variables    resolve.Variables
	visitor      *plan.Visitor
	extractFn    func(tpl string) (string, error)
}

func (p *Planner[PB, P, E]) SetID(id int) {
	p.id = id
}

func (p *Planner[PB, P, E]) ID() (id int) {
	return p.id
}

func (p *Planner[PB, P, E]) DownstreamResponseFieldAlias(downstreamFieldRef int) (alias string, exists bool) {
	// skip, not required
	return
}

func (p *Planner[PB, P, E]) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
	}
}

func (p *Planner[PB, P, E]) Register(visitor *plan.Visitor, configuration plan.DataSourceConfiguration[*PlannerConfig[PB, P, E]], _ plan.DataSourcePlannerConfiguration) error {
	p.visitor = visitor
	visitor.Walker.RegisterEnterFieldVisitor(p)
	visitor.Walker.RegisterEnterDocumentVisitor(p)
	p.config = configuration.CustomConfiguration()

	return nil
}

func (p *Planner[PB, P, E]) ConfigureFetch() resolve.FetchConfiguration {
	if p.config == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("data source not set"))
		return resolve.FetchConfiguration{}
	}

	pubSubDataSource, err := p.config.ProviderBuilder.BuildEngineDataSourceFactory(p.config.Event)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to build data source: %w", err))
		return resolve.FetchConfiguration{}
	}

	err = pubSubDataSource.TransformEventData(p.extractFn)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(err)
	}

	dataSource, err := pubSubDataSource.ResolveDataSource()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get data source: %w", err))
		return resolve.FetchConfiguration{}
	}

	event, err := eventdata.BuildEventDataBytes(p.rootFieldRef, p.visitor.Operation, &p.variables)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source input: %w", err))
		return resolve.FetchConfiguration{}
	}

	input, err := pubSubDataSource.ResolveDataSourceInput(event)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source input: %w", err))
		return resolve.FetchConfiguration{}
	}

	return resolve.FetchConfiguration{
		Input:      input,
		Variables:  p.variables,
		DataSource: dataSource,
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{pubSubDataSource.GetFieldName()},
		},
	}
}

func (p *Planner[PB, P, E]) ConfigureSubscription() plan.SubscriptionConfiguration {
	if p.config == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("data source not set"))
		return plan.SubscriptionConfiguration{}
	}

	pubSubDataSource, err := p.config.ProviderBuilder.BuildEngineDataSourceFactory(p.config.Event)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source subscription: %w", err))
		return plan.SubscriptionConfiguration{}
	}

	err = pubSubDataSource.TransformEventData(p.extractFn)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(err)
	}

	dataSource, err := pubSubDataSource.ResolveDataSourceSubscription()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source subscription: %w", err))
		return plan.SubscriptionConfiguration{}
	}

	input, err := pubSubDataSource.ResolveDataSourceSubscriptionInput()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source subscription input: %w", err))
		return plan.SubscriptionConfiguration{}
	}

	return plan.SubscriptionConfiguration{
		Input:      input,
		Variables:  p.variables,
		DataSource: dataSource,
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{pubSubDataSource.GetFieldName()},
		},
	}
}

func (p *Planner[PB, P, E]) addContextVariableByArgumentRef(argumentRef int, operationTypeRef int, argumentPath []string) (string, error) {
	variablePath, err := p.visitor.Operation.VariablePathByArgumentRefAndArgumentPath(argumentRef, argumentPath, operationTypeRef)
	if err != nil {
		return "", err
	}
	/* The definition is passed as both definition and operation below because getJSONRootType resolves the type
	 * from the first argument, but finalInputValueTypeRef comes from the definition
	 */
	contextVariable := &resolve.ContextVariable{
		Path:     variablePath,
		Renderer: resolve.NewPlainVariableRenderer(),
	}
	variablePlaceHolder, _ := p.variables.AddVariable(contextVariable)
	return variablePlaceHolder, nil
}

func (p *Planner[PB, P, E]) extractArgumentTemplate(fieldRef int, operationDefinitionRef int, typeDefinitionRef int, template string) (string, error) {
	matches := argument_templates.ArgumentTemplateRegex.FindAllStringSubmatch(template, -1)
	// If no argument templates are defined, there are only static values
	if len(matches) < 1 {
		return template, nil
	}
	fieldNameBytes := p.visitor.Operation.FieldNameBytes(fieldRef)
	// TODO: handling for interfaces and unions
	fieldDefinitionRef, ok := p.visitor.Definition.ObjectTypeDefinitionFieldWithName(typeDefinitionRef, fieldNameBytes)
	if !ok {
		return "", fmt.Errorf(`expected field definition to exist for field "%s"`, fieldNameBytes)
	}
	templateWithVariableTemplateReplacements := template
	for templateNumber, groups := range matches {
		// The first group is the whole template; the second is the period-delimited argument path
		if len(groups) != 2 {
			return "", fmt.Errorf(`argument template #%d defined on field "%s" is invalid: expected 2 matching groups but received %d`, templateNumber+1, fieldNameBytes, len(groups)-1)
		}
		validationResult, err := argument_templates.ValidateArgumentPath(p.visitor.Definition, groups[1], fieldDefinitionRef)
		if err != nil {
			return "", fmt.Errorf(`argument template #%d defined on field "%s" is invalid: %w`, templateNumber+1, fieldNameBytes, err)
		}
		argumentNameBytes := []byte(validationResult.ArgumentPath[0])
		argumentRef, ok := p.visitor.Operation.FieldArgument(fieldRef, argumentNameBytes)
		if !ok {
			return "", fmt.Errorf(`operation field "%s" does not define argument "%s"`, fieldNameBytes, argumentNameBytes)
		}
		// variablePlaceholder has the form $$0$$, $$1$$, etc.
		variablePlaceholder, err := p.addContextVariableByArgumentRef(argumentRef, operationDefinitionRef, validationResult.ArgumentPath)
		if err != nil {
			return "", fmt.Errorf(`failed to retrieve variable placeholder for argument ""%s" defined on operation field "%s": %w`, argumentNameBytes, fieldNameBytes, err)
		}
		// Replace the template literal with the variable placeholder (and reuse the variable if it already exists)
		templateWithVariableTemplateReplacements = strings.ReplaceAll(templateWithVariableTemplateReplacements, groups[0], variablePlaceholder)
	}

	return templateWithVariableTemplateReplacements, nil
}

func (p *Planner[PB, P, E]) EnterDocument(_, _ *ast.Document) {
	p.rootFieldRef = -1
}

func (p *Planner[PB, P, E]) EnterField(ref int) {
	if p.rootFieldRef != -1 {
		// This is a nested field; nothing needs to be done
		return
	}
	p.rootFieldRef = ref

	operationDefinitionRef := p.visitor.Walker.Ancestors[0].Ref
	typeDefinitionRef := p.visitor.Walker.EnclosingTypeDefinition.Ref

	p.extractFn = func(tpl string) (string, error) {
		return p.extractArgumentTemplate(ref, operationDefinitionRef, typeDefinitionRef, tpl)
	}
}
