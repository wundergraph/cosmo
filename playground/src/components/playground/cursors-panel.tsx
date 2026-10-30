import { useContext } from 'react';
import { TraceContext } from '@/components/playground/trace-view';
import { PlaygroundContext } from '@/components/playground/types';
import { Button } from '@/components/ui/button';
import { useLocalStorage } from '@/lib/use-local-storage';
import {
  CURSOR_STORAGE_KEY,
  clearAllCursors,
  clearCursor,
  cursorKey,
  subscriptionRootFieldName,
} from '@/lib/cursor-storage';

/**
 * Editor tools tab listing the cursors the playground stored for EDFS subscriptions.
 *
 * Cursors are keyed by tab plus endpoint plus subscription root field, so editing the operation —
 * renaming it, aliasing the field, changing arguments — keeps using the same cursor, while two
 * tabs never share one even if they subscribe to the same field.
 */
export const CursorsPanel = () => {
  const { cursorsEnabled, endpointUrl } = useContext(TraceContext);
  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(PlaygroundContext);

  // Subscribing through useLocalStorage keeps the panel live while a subscription streams:
  // cursor-storage dispatches the same 'local-storage' event on every write.
  const [cursors] = useLocalStorage<Record<string, string>>(CURSOR_STORAGE_KEY, {});

  const activeTab = tabs[activeTabIndex];
  const fieldName = subscriptionRootFieldName(activeTab?.query, activeTab?.operationName);
  const activeKey = fieldName && activeTab ? cursorKey(activeTab.id, endpointUrl, fieldName) : null;
  const activeCursor = activeKey ? (cursors[activeKey] ?? null) : null;

  const otherEntries = Object.entries(cursors).filter(([key]) => key !== activeKey);

  return (
    <div className="flex h-full w-full flex-col gap-y-4 overflow-auto p-4 text-sm">
      <div className="flex items-start justify-between gap-x-4">
        <div className="space-y-1">
          <p className="font-semibold">Subscription cursors</p>
          <p className="text-muted-foreground">
            {cursorsEnabled
              ? 'Cursors are requested on every subscription and sent back on the next start.'
              : 'Cursors are disabled. Enable them with the toolbar button to request and resume from cursors.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={Object.keys(cursors).length === 0} onClick={clearAllCursors}>
          Clear all
        </Button>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">Current operation</p>
        {!fieldName ? (
          <p className="text-muted-foreground">The active tab does not contain a subscription.</p>
        ) : (
          <div className="flex items-start justify-between gap-x-4 rounded-md border p-3">
            <div className="min-w-0 space-y-1">
              <p className="font-mono">{fieldName}</p>
              <p className="break-all font-mono text-muted-foreground">{activeCursor ?? 'none'}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!activeCursor}
              onClick={() => activeKey && clearCursor(activeKey)}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {otherEntries.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Other stored cursors</p>
          {otherEntries.map(([key, cursor]) => (
            <div key={key} className="flex items-start justify-between gap-x-4 rounded-md border p-3">
              <div className="min-w-0 space-y-1">
                <p className="break-all font-mono">{key}</p>
                <p className="break-all font-mono text-muted-foreground">{cursor}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => clearCursor(key)}>
                Clear
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
