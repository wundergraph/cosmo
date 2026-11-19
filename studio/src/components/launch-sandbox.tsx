import { RocketIcon } from '@radix-ui/react-icons';
import { Button } from '@/components/ui/button';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { hubLaunchUrl } from '@/lib/hub';

export interface SandboxGraph {
  name: string;
  namespace: string;
  supportsFederation: boolean;
}

const useLaunchUrl = (graph: SandboxGraph | undefined): string | undefined => {
  const organization = useCurrentOrganization();
  if (!graph || !graph.supportsFederation) {
    return undefined;
  }

  return hubLaunchUrl({
    hubUrl: process.env.NEXT_PUBLIC_HUB_URL,
    graph: graph.name,
    namespace: graph.namespace,
    organization: organization?.slug,
  });
};

/** Opens Hub with a sandbox of the federated graph. Hidden when Studio has no Hub URL. */
export const LaunchSandboxButton = ({ graph }: { graph: SandboxGraph | undefined }) => {
  const launchUrl = useLaunchUrl(graph);
  if (!launchUrl) {
    return null;
  }

  return (
    <Button asChild size="sm">
      <a href={launchUrl} target="_blank" rel="noreferrer">
        <RocketIcon className="mr-2 h-4 w-4" />
        Launch sandbox
      </a>
    </Button>
  );
};

/** A pointer from the graph visualization to trying changes in a Hub sandbox. */
export const LaunchSandboxNudge = ({ graph }: { graph: SandboxGraph | undefined }) => {
  const launchUrl = useLaunchUrl(graph);
  if (!launchUrl) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-sm text-muted-foreground">
      <span>Try a schema change against this graph without publishing it.</span>
      <a href={launchUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
        Launch sandbox
      </a>
    </div>
  );
};
