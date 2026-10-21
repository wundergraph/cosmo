import { useEditorContext } from '@graphiql/react';
import { useEffect, useState } from 'react';
import { DeferAdvisorPanel } from './defer-advisor-panel';
import { getPillController } from './pills-controller';

export const DeferAdvisorPluginContent = ({ routingUrl }: { routingUrl: string }) => {
  const { queryEditor } = useEditorContext({ nonNull: true });
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
      editor={queryEditor}
      onQueryChange={(next) => {
        if (queryEditor) {
          getPillController(queryEditor).writeQuery(next);
        }
      }}
    />
  );
};
