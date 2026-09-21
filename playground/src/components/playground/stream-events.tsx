import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LuChevronDown, LuChevronUp, LuHistory } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { useLocalStorage } from '@/lib/use-local-storage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '../empty-state';
import { ViewOutput } from './view-output';
import { PlaygroundContext } from './types';
import { CursorPosition, DecodedCursor, decodeCursor, diffPositions, PositionAdvance } from './cursor';

const MAX_ENTRIES = 500;

type BaseEntry = { id: number; receivedAt: number };
export type StreamMarkerEntry = BaseEntry & { kind: 'marker'; resumedFrom: DecodedCursor | null };
export type StreamDataEntry = BaseEntry & {
  kind: 'event';
  seq: number;
  cursor?: string;
  advances: PositionAdvance[];
  payload: unknown;
};
export type StreamErrorEntry = BaseEntry & { kind: 'error'; message: string };
export type StreamEntry = StreamMarkerEntry | StreamDataEntry | StreamErrorEntry;

export type StreamApi = {
  cursorsEnabled: boolean;
  resumeEnabled: boolean;
  lastCursor: string | null;
  startStream: (resumeFrom?: string) => void;
  pushEvent: (chunk: unknown) => void;
  pushError: (message: string) => void;
  endStream: () => void;
};

const noopStreamApi: StreamApi = {
  cursorsEnabled: false,
  resumeEnabled: true,
  lastCursor: null,
  startStream: () => {},
  pushEvent: () => {},
  pushError: () => {},
  endStream: () => {},
};

type StreamEventsContextType = {
  cursorsEnabled: boolean;
  setCursorsEnabled: (val: boolean) => void;
  resumeEnabled: boolean;
  setResumeEnabled: (val: boolean) => void;
  lastCursor: string | null;
  entries: StreamEntry[];
  isStreaming: boolean;
  panelOpen: boolean;
  setPanelOpen: (val: boolean) => void;
  clearEvents: () => void;
  forgetCursor: () => void;
  streamApiRef: { current: StreamApi };
};

export const StreamEventsContext = createContext<StreamEventsContextType>({
  cursorsEnabled: false,
  setCursorsEnabled: () => {},
  resumeEnabled: true,
  setResumeEnabled: () => {},
  lastCursor: null,
  entries: [],
  isStreaming: false,
  panelOpen: true,
  setPanelOpen: () => {},
  clearEvents: () => {},
  forgetCursor: () => {},
  streamApiRef: { current: noopStreamApi },
});

export const StreamEventsProvider = ({ children }: { children: React.ReactNode }) => {
  const [cursorsEnabled, setCursorsEnabled] = useLocalStorage('playground:cursors:enabled', false);
  const [resumeEnabled, setResumeEnabled] = useLocalStorage('playground:cursors:resume', true);
  const [lastCursor, setLastCursor] = useLocalStorage<string | null>('playground:cursors:last', null);

  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const idRef = useRef(0);
  const seqRef = useRef(0);
  const positionRef = useRef<CursorPosition | null>(null);

  const pushEntry = useCallback((entry: StreamEntry) => {
    setEntries((prev) => {
      const next = [...prev, entry];
      if (next.length > MAX_ENTRIES) {
        next.splice(0, next.length - MAX_ENTRIES);
      }
      return next;
    });
  }, []);

  const startStream = useCallback(
    (resumeFrom?: string) => {
      const decoded = resumeFrom ? decodeCursor(resumeFrom) : null;
      positionRef.current = decoded?.position ?? null;
      setIsStreaming(true);
      pushEntry({ id: idRef.current++, kind: 'marker', receivedAt: Date.now(), resumedFrom: decoded });
    },
    [pushEntry],
  );

  const pushEvent = useCallback(
    (chunk: unknown) => {
      const cursor = (chunk as any)?.extensions?.cursor as string | undefined;
      const decoded = cursor ? decodeCursor(cursor) : null;
      const advances = decoded ? diffPositions(positionRef.current, decoded.position) : [];

      if (decoded) {
        positionRef.current = decoded.position;
        setLastCursor(cursor as string);
      }

      pushEntry({
        id: idRef.current++,
        kind: 'event',
        seq: seqRef.current++,
        receivedAt: Date.now(),
        cursor,
        advances,
        payload: chunk,
      });
    },
    [pushEntry, setLastCursor],
  );

  const pushError = useCallback(
    (message: string) => {
      pushEntry({ id: idRef.current++, kind: 'error', receivedAt: Date.now(), message });
    },
    [pushEntry],
  );

  const endStream = useCallback(() => {
    setIsStreaming(false);
  }, []);

  const clearEvents = useCallback(() => {
    setEntries([]);
  }, []);

  const forgetCursor = useCallback(() => {
    setLastCursor(null);
    positionRef.current = null;
  }, [setLastCursor]);

  const streamApiRef = useRef<StreamApi>(noopStreamApi);
  useEffect(() => {
    streamApiRef.current = { cursorsEnabled, resumeEnabled, lastCursor, startStream, pushEvent, pushError, endStream };
  });

  const value = useMemo<StreamEventsContextType>(
    () => ({
      cursorsEnabled,
      setCursorsEnabled,
      resumeEnabled,
      setResumeEnabled,
      lastCursor,
      entries,
      isStreaming,
      panelOpen,
      setPanelOpen,
      clearEvents,
      forgetCursor,
      streamApiRef,
    }),
    [
      cursorsEnabled,
      setCursorsEnabled,
      resumeEnabled,
      setResumeEnabled,
      lastCursor,
      entries,
      isStreaming,
      panelOpen,
      clearEvents,
      forgetCursor,
    ],
  );

  return <StreamEventsContext.Provider value={value}>{children}</StreamEventsContext.Provider>;
};

export const ToggleCursors = () => {
  const { cursorsEnabled, setCursorsEnabled } = useContext(StreamEventsContext);

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button
          onClick={() => setCursorsEnabled(!cursorsEnabled)}
          variant="ghost"
          size="icon"
          className="graphiql-toolbar-button"
        >
          <LuHistory
            className={cn('graphiql-toolbar-icon', {
              'text-success': cursorsEnabled,
            })}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
        {cursorsEnabled
          ? 'Cursor delivery enabled — subscriptions request delivery-guarantee: cursor'
          : 'Cursor delivery disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const formatTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleTimeString('en-US', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const positionLabel = (position: CursorPosition) =>
  Object.entries(position)
    .flatMap(([topic, partitions]) =>
      Object.entries(partitions).map(([partition, { offset }]) => `${topic}/${partition} @${offset}`),
    )
    .join(', ');

const EntryRow = ({ entry }: { entry: StreamEntry }) => {
  if (entry.kind === 'marker') {
    return (
      <div className="px-3 py-1 text-muted-foreground">
        ▶ {entry.resumedFrom ? `resumed from ${positionLabel(entry.resumedFrom.position)}` : 'live from now'}
      </div>
    );
  }

  if (entry.kind === 'error') {
    return <div className="px-3 py-1 text-destructive">✖ {entry.message}</div>;
  }

  const advance = entry.advances[0];

  return (
    <>
      {advance && advance.skipped > 0 && (
        <div className="px-3 py-1 text-destructive">
          ⚠ {advance.skipped} event{advance.skipped === 1 ? '' : 's'} skipped
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-1 hover:bg-muted/20">
        <span className="w-12 flex-shrink-0 text-muted-foreground">
          {advance ? `#${advance.offset}` : `#${entry.seq}`}
        </span>
        {advance ? (
          <span className="flex-shrink-0">
            {advance.topic}/{advance.partition} @{advance.offset}
          </span>
        ) : (
          <Badge variant="muted" className="flex-shrink-0">
            no cursor
          </Badge>
        )}
        {advance && (
          <span className={cn('w-8 flex-shrink-0', advance.skipped > 0 ? 'text-destructive' : 'text-success')}>
            {advance.delta === null ? 'new' : `+${advance.delta}`}
          </span>
        )}
        <span className="flex-shrink-0 text-muted-foreground">{formatTime(entry.receivedAt)}</span>
        <span className="truncate text-muted-foreground">{JSON.stringify(entry.payload)}</span>
        <ViewOutput output={entry.payload} asChild label="View" variant="default" />
      </div>
    </>
  );
};

export const StreamEventsPanel = () => {
  const {
    cursorsEnabled,
    resumeEnabled,
    setResumeEnabled,
    lastCursor,
    entries,
    isStreaming,
    panelOpen,
    setPanelOpen,
    clearEvents,
    forgetCursor,
  } = useContext(StreamEventsContext);
  const { view } = useContext(PlaygroundContext);

  const visible = cursorsEnabled && view === 'response';

  useEffect(() => {
    const parent = document.getElementById('response-parent');
    const panel = document.getElementById('stream-events-panel');
    if (!parent) {
      return;
    }
    parent.classList.toggle('with-events-panel', visible && panelOpen);
    panel?.classList.toggle('hidden', !visible);
    return () => {
      parent.classList.remove('with-events-panel');
      panel?.classList.add('hidden');
    };
  }, [visible, panelOpen]);

  if (!visible) {
    return null;
  }

  const decodedLast = lastCursor ? decodeCursor(lastCursor) : null;
  const eventCount = entries.filter((e) => e.kind === 'event').length;

  return (
    <div className="flex h-full w-full flex-col text-xs">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <span className="font-medium">Events ({eventCount})</span>
        {isStreaming && <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-success" />}
        <label className="flex items-center gap-1.5">
          <Checkbox checked={resumeEnabled} onCheckedChange={(v) => setResumeEnabled(!!v)} />
          Resume from last cursor
        </label>
        {decodedLast && (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => navigator.clipboard.writeText(lastCursor as string)}
              >
                {positionLabel(decodedLast.position)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
              <pre className="max-w-xs whitespace-pre-wrap">{JSON.stringify(decodedLast, null, 2)}</pre>
            </TooltipContent>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={forgetCursor} disabled={!lastCursor}>
            Forget cursor
          </Button>
          <Button size="sm" variant="ghost" onClick={clearEvents} disabled={entries.length === 0}>
            Clear
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setPanelOpen(!panelOpen)}>
            {panelOpen ? <LuChevronDown /> : <LuChevronUp />}
          </Button>
        </div>
      </div>
      {panelOpen && (
        <div className="scrollbar-custom flex-1 overflow-y-auto font-mono">
          {entries.length === 0 ? (
            <EmptyState
              icon={<LuHistory />}
              title="Waiting for events"
              description="Run a subscription to see events here"
            />
          ) : (
            entries
              .slice()
              .reverse()
              .map((entry) => <EntryRow key={entry.id} entry={entry} />)
          )}
        </div>
      )}
    </div>
  );
};
