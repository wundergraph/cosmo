import { useEditorContext } from '@graphiql/react';
import { useEffect, useMemo } from 'react';
import { useDefer } from './defer-context';

// Lives in GraphiQL's toolbar, which is always rendered. The advisor tab unmounts when it closes,
// but the pills have to stay in the editor.
export const DeferPillsSync = () => {
  const { queryEditor, variableEditor, headerEditor, tabs, activeTabIndex } = useEditorContext({ nonNull: true });
  const store = useDefer();

  useEffect(() => {
    if (!queryEditor) {
      return;
    }
    return store.bind({ query: queryEditor, variables: variableEditor, headers: headerEditor });
  }, [store, queryEditor, variableEditor, headerEditor]);

  const activeTab = tabs[activeTabIndex]?.id ?? '';
  const openTabs = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  useEffect(() => {
    store.setTabs(activeTab, openTabs);
  }, [store, activeTab, openTabs]);

  return null;
};
