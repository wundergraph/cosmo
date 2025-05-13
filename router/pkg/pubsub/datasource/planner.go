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

type Planner struct {
	id                      int
	pubSubDataSource        PubSubDataSource
	pubSubDataSourceMatcher PubSubDataSourceMatcherFn
	rootFieldRef            int
	variables               resolve.Variables
	visitor                 *plan.Visitor
}

func (p *Planner) SetID(id int) {
	p.id = id
}

func (p *Planner) ID() (id int) {
	return p.id
}

func (p *Planner) DownstreamResponseFieldAlias(downstreamFieldRef int) (alias string, exists bool) {
	// skip, not required
	return
}

func (p *Planner) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
	}
}

func (p *Planner) Register(visitor *plan.Visitor, configuration plan.DataSourceConfiguration[PubSubDataSourceMatcherFn], _ plan.DataSourcePlannerConfiguration) error {
	p.visitor = visitor
	visitor.Walker.RegisterEnterFieldVisitor(p)
	visitor.Walker.RegisterEnterDocumentVisitor(p)
	p.pubSubDataSourceMatcher = configuration.CustomConfiguration()

	return nil
}

func (p *Planner) ConfigureFetch() resolve.FetchConfiguration {
	var dataSource resolve.DataSource

	dataSource, err := p.pubSubDataSource.ResolveDataSource()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get data source: %w", err))
		return resolve.FetchConfiguration{}
	}

	event, err := eventdata.BuildEventDataBytes(p.rootFieldRef, p.visitor.Operation, &p.variables)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source input: %w", err))
		return resolve.FetchConfiguration{}
	}

	input, err := p.pubSubDataSource.ResolveDataSourceInput(event)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source input: %w", err))
		return resolve.FetchConfiguration{}
	}

	return resolve.FetchConfiguration{
		Input:      input,
		Variables:  p.variables,
		DataSource: dataSource,
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{p.pubSubDataSource.EngineEventConfiguration().GetFieldName()},
		},
	}
}

func (p *Planner) ConfigureSubscription() plan.SubscriptionConfiguration {
	dataSource, err := p.pubSubDataSource.ResolveDataSourceSubscription()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source subscription: %w", err))
		return plan.SubscriptionConfiguration{}
	}

	input, err := p.pubSubDataSource.ResolveDataSourceSubscriptionInput()
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to get resolve data source subscription input: %w", err))
		return plan.SubscriptionConfiguration{}
	}

	return plan.SubscriptionConfiguration{
		Input:      input,
		Variables:  p.variables,
		DataSource: dataSource,
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{p.pubSubDataSource.EngineEventConfiguration().GetFieldName()},
		},
	}
}

func (p *Planner) addContextVariableByArgumentRef(argumentRef int, argumentPath []string) (string, error) {
	variablePath, err := p.visitor.Operation.VariablePathByArgumentRefAndArgumentPath(argumentRef, argumentPath, p.visitor.Walker.Ancestors[0].Ref)
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

func StringParser(subject string) (string, error) {
	matches := argument_templates.ArgumentTemplateRegex.FindAllStringSubmatch(subject, -1)
	if len(matches) < 1 {
		return subject, nil
	}
	return "", fmt.Errorf(`subject "%s" is not a valid NATS subject`, subject)
}

func (p *Planner) extractArgumentTemplate(fieldRef int, template string) (string, error) {
	matches := argument_templates.ArgumentTemplateRegex.FindAllStringSubmatch(template, -1)
	// If no argument templates are defined, there are only static values
	if len(matches) < 1 {
		return template, nil
	}
	fieldNameBytes := p.visitor.Operation.FieldNameBytes(fieldRef)
	// TODO: handling for interfaces and unions
	fieldDefinitionRef, ok := p.visitor.Definition.ObjectTypeDefinitionFieldWithName(p.visitor.Walker.EnclosingTypeDefinition.Ref, fieldNameBytes)
	if !ok {
		return "", fmt.Errorf(`expected field definition to exist for field "%s"`, fieldNameBytes)
	}
	templateWithVariableTemplateReplacements := template
	for templateNumber, groups := range matches {
		// The first group is the whole template; the second is the period delimited argument path
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
		variablePlaceholder, err := p.addContextVariableByArgumentRef(argumentRef, validationResult.ArgumentPath)
		if err != nil {
			return "", fmt.Errorf(`failed to retrieve variable placeholder for argument ""%s" defined on operation field "%s": %w`, argumentNameBytes, fieldNameBytes, err)
		}
		// Replace the template literal with the variable placeholder (and reuse the variable if it already exists)
		templateWithVariableTemplateReplacements = strings.ReplaceAll(templateWithVariableTemplateReplacements, groups[0], variablePlaceholder)
	}

	return templateWithVariableTemplateReplacements, nil
}

func (p *Planner) EnterDocument(_, _ *ast.Document) {
	p.rootFieldRef = -1
}

func (p *Planner) EnterField(ref int) {
	if p.rootFieldRef != -1 {
		// This is a nested field; nothing needs to be done
		return
	}
	p.rootFieldRef = ref

	fieldName := p.visitor.Operation.FieldNameString(ref)
	typeName := p.visitor.Walker.EnclosingTypeDefinition.NameString(p.visitor.Definition)

	extractFn := func(tpl string) (string, error) {
		return p.extractArgumentTemplate(ref, tpl)
	}

	ds, err := p.pubSubDataSourceMatcher(typeName, fieldName, extractFn)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(err)
	}

	p.pubSubDataSource = ds
}
