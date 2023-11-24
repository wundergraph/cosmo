import { cn } from "@/lib/utils";
import { capitalCase, sentenceCase } from "change-case";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { LoadStats } from "./types";

export const ViewLoadStats = ({
  loadStats,
  asChild,
}: {
  loadStats: LoadStats;
  asChild?: boolean;
}) => {
  return (
    <Dialog>
      <DialogTrigger
        asChild={asChild}
        className={cn(!asChild && "text-primary")}
      >
        {asChild ? (
          <Button variant="secondary" size="sm" className="flex-1">
            <span className="flex-shrink-0">View Load Stats</span>
          </Button>
        ) : (
          "View Load Stats"
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Load Stats</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom flex h-96 flex-col gap-y-4 overflow-auto">
          {loadStats.map((l) => {
            return (
              <div key={l.name} className="text-sm text-muted-foreground">
                <h2 className="mb-1 text-base text-foreground">
                  {capitalCase(l.name)}
                </h2>
                <p>Duration since start: {l.durationSinceStart || "0ms"}</p>
                {Object.entries(l.attributes)
                  .filter((e) => e[1])
                  .map(([key, val]) => {
                    return (
                      <div key={key}>
                        <p>
                          {sentenceCase(key)}: {`${val}`}
                        </p>
                      </div>
                    );
                  })}
                {l.idleTime && <p>Idle Time: {l.idleTime}</p>}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
