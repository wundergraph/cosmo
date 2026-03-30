import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { CubeIcon, GlobeIcon, InfoCircledIcon, LayersIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { docsBaseURL } from '@/lib/constants';
import { useRouter } from 'next/router';
import type { ComponentType } from 'react';

function ConceptCard({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
        <Icon className="h-5 w-5 text-primary" />
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}

function SubgraphsCard() {
  return (
    <ConceptCard icon={CubeIcon} title="Subgraphs">
      Independent GraphQL services, each responsible for a specific domain. Teams can develop and deploy them
      independently.
    </ConceptCard>
  );
}

function RouterCard() {
  return (
    <ConceptCard icon={MixerHorizontalIcon} title="Router">
      A single entry point that receives client queries and routes them to the appropriate subgraphs, then aggregates
      the responses.
    </ConceptCard>
  );
}

function CompositionCard() {
  return (
    <ConceptCard icon={LayersIcon} title="Composition">
      Subgraph schemas are automatically composed into one unified schema. Composition checks catch breaking changes
      before they reach production.
    </ConceptCard>
  );
}

function UnifiedSchemaCard() {
  return (
    <ConceptCard icon={GlobeIcon} title="Unified Schema">
      Clients interact with a single GraphQL API. They never need to know which subgraph serves which data.
    </ConceptCard>
  );
}

interface Step2FederationProps {
  onDismiss: () => void;
}

export function Step2Federation({ onDismiss }: Step2FederationProps) {
  const router = useRouter();
  const org = useCurrentOrganization();

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">What is GraphQL Federation?</h2>
        <p className="text-sm text-muted-foreground">
          Federation lets you split your GraphQL API into multiple independent services (subgraphs) while exposing a
          single, unified graph to your clients. Here are the key concepts:
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SubgraphsCard />
        <RouterCard />
        <CompositionCard />
        <UnifiedSchemaCard />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        <InfoCircledIcon className="h-4 w-4 shrink-0" />
        <p>
          In the next step, you&apos;ll need the{' '}
          <a
            href={docsBaseURL + '/cli/intro'}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            <code>wgc</code>
          </a>{' '}
          installed to create your first graph.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onDismiss();
            router.push(`/${org?.slug}/graphs`);
          }}
        >
          Skip
        </Button>
        <Button type="button">Continue</Button>
      </div>
    </div>
  );
}
