import { cn } from '@/lib/utils';
import { CodeViewer } from '../code-viewer';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { CacheTrace, getCacheStatus, getCacheStatusLabel } from './types';

export const ViewCache = ({ cacheTrace, asChild }: { cacheTrace: CacheTrace; asChild?: boolean }) => {
  const status = getCacheStatus(cacheTrace);
  const isHit = status === 'l1-hit' || status === 'l2-hit';

  return (
    <Dialog>
      <DialogTrigger asChild={asChild} className={cn(!asChild && 'text-primary')}>
        {asChild ? (
          <Button variant="secondary" size="sm" className="flex-1">
            <span className="flex-shrink-0">View Cache</span>
          </Button>
        ) : (
          'View Cache'
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Entity Cache</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom flex max-h-[70vh] flex-col gap-y-4 overflow-auto text-sm">
          <div className="flex flex-col gap-y-1">
            <h2 className="mb-1 text-base font-medium text-foreground">Status</h2>
            <p className="text-muted-foreground">
              Result:{' '}
              <span
                className={cn(
                  'font-medium',
                  isHit ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400',
                )}
              >
                {getCacheStatusLabel(cacheTrace)}
              </span>
            </p>
            <p className="text-muted-foreground">Entities: {cacheTrace.entityCount}</p>
          </div>
          <div className="flex flex-col gap-y-1">
            <h2 className="mb-1 text-base font-medium text-foreground">Configuration</h2>
            <p className="text-muted-foreground">Cache Name: {cacheTrace.cacheName}</p>
            <p className="text-muted-foreground">TTL: {cacheTrace.ttlSeconds}s</p>
            <p className="text-muted-foreground">L1 Enabled: {cacheTrace.l1Enabled ? 'Yes' : 'No'}</p>
            <p className="text-muted-foreground">L2 Enabled: {cacheTrace.l2Enabled ? 'Yes' : 'No'}</p>
          </div>
          <div className="flex flex-col gap-y-1">
            <h2 className="mb-1 text-base font-medium text-foreground">Statistics</h2>
            <p className="text-muted-foreground">
              L1: {cacheTrace.l1Hit} hit / {cacheTrace.l1Miss} miss
            </p>
            <p className="text-muted-foreground">
              L2: {cacheTrace.l2Hit} hit / {cacheTrace.l2Miss} miss
            </p>
            {cacheTrace.durationPretty && (
              <p className="text-muted-foreground">Cache Duration: {cacheTrace.durationPretty}</p>
            )}
            {cacheTrace.l2GetDurationPretty && (
              <p className="text-muted-foreground">L2 Get: {cacheTrace.l2GetDurationPretty}</p>
            )}
            {cacheTrace.l2SetDurationPretty && (
              <p className="text-muted-foreground">L2 Set: {cacheTrace.l2SetDurationPretty}</p>
            )}
          </div>
          {cacheTrace.keys && cacheTrace.keys.length > 0 && (
            <div className="flex flex-col gap-y-1">
              <h2 className="mb-1 text-base font-medium text-foreground">Cache Keys ({cacheTrace.keys.length})</h2>
              <div className="rounded border">
                <CodeViewer
                  code={JSON.stringify(
                    cacheTrace.keys.map((k) => {
                      try {
                        return JSON.parse(k);
                      } catch {
                        return k;
                      }
                    }),
                    null,
                    2,
                  )}
                  language="json"
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
