import { useEditorContext } from '@graphiql/react';
import { useEffect, useState } from 'react';
import { DeferAdvisorPanel } from './defer-advisor-panel';

export const DeferAdvisorPluginContent = () => {
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

  return <DeferAdvisorPanel query={query} onQueryChange={(next) => queryEditor?.setValue(next)} />;
};
