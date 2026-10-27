import { useEditorContext } from '@graphiql/react';
import { useEffect } from 'react';
import { useDefer } from './defer-context';

// Lives in GraphiQL's toolbar, which is always rendered. The advisor tab unmounts when it closes,
// but the pills have to stay in the editor.
export const DeferPillsSync = () => {
  const { queryEditor } = useEditorContext({ nonNull: true });
  const store = useDefer();

  useEffect(() => {
    if (!queryEditor) {
      return;
    }
    return store.bind(queryEditor);
  }, [store, queryEditor]);

  return null;
};
