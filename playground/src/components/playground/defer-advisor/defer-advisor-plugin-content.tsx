import { useEditorContext } from '@graphiql/react';
import { useEffect, useState } from 'react';
import { DeferAdvisorPanel } from './defer-advisor-panel';
import { parseVariables } from './probe';
import { getDeferController } from './defer-controller';

export const DeferAdvisorPluginContent = ({
  routingUrl,
  getHeaders,
}: {
  routingUrl: string;
  getHeaders: (rawHeaders: string) => Record<string, string>;
}) => {
  const { queryEditor, variableEditor, headerEditor } = useEditorContext({ nonNull: true });
  const [query, setQuery] = useState(() => queryEditor?.getValue() ?? '');
  // The controller is cached per editor and outlives this component, so latencies survive a tab switch.
  const controller = queryEditor ? getDeferController(queryEditor) : null;

  useEffect(() => {
    if (!queryEditor) {
      return;
    }
    setQuery(queryEditor.getValue());
    const onChange = () => setQuery(queryEditor.getValue());
    queryEditor.on('change', onChange);
    return () => {
      queryEditor.off('change', onChange);
    };
  }, [queryEditor]);

  return (
    <DeferAdvisorPanel
      query={query}
      routingUrl={routingUrl}
      getRequest={() => ({
        headers: getHeaders(headerEditor?.getValue() ?? ''),
        ...parseVariables(variableEditor?.getValue() ?? ''),
      })}
      controller={controller}
      onQueryChange={(next) => controller?.writeQuery(next)}
    />
  );
};
