import { useEditorContext } from '@graphiql/react';
import { useEffect, useState } from 'react';
import { DeferAdvisorPanel } from './defer-advisor-panel';
import { parseVariables } from './probe';
import { useDefer } from './defer-context';

export const DeferAdvisorPluginContent = ({
  routingUrl,
  getHeaders,
}: {
  routingUrl: string;
  getHeaders: (rawHeaders: string) => Record<string, string>;
}) => {
  const { queryEditor, variableEditor, headerEditor } = useEditorContext({ nonNull: true });
  const store = useDefer();
  const [query, setQuery] = useState(() => queryEditor?.getValue() ?? '');

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
      onQueryChange={(next) => store.writeQuery(next)}
    />
  );
};
