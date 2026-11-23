import Link from 'next/link';
import { SiApollographql } from 'react-icons/si';
import { ChevronDoubleRightIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@radix-ui/react-icons';
import { Logo } from './logo';
import { Card } from './ui/card';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useWorkspace } from '@/hooks/use-workspace';
import { buildUrl } from '@/lib/build-url';

export const MigrateFromApolloCard = ({ compact }: { compact?: boolean }) => {
  const organizationSlug = useCurrentOrganization()?.slug;
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  return (
    <Link href={buildUrl('/:organizationSlug/new', { organizationSlug, namespace, tab: 'apollo' })} className="w-full">
      {compact ? (
        <Card className="flex w-full items-center rounded-xl border-primary/70 bg-primary/10 px-5 py-4 text-left transition-colors hover:bg-primary/15">
          <div className="flex shrink-0 items-center gap-x-2 text-foreground">
            <SiApollographql className="size-5" />
            <ChevronDoubleRightIcon className="size-4 text-muted-foreground" />
            <Logo width={22} height={22} />
          </div>
          <div className="ml-5 min-w-0 flex-1">
            <p className="text-base font-semibold leading-5 text-primary">Migrate from Apollo</p>
            <p className="text-sm leading-5 text-muted-foreground">Bring your existing supergraph over</p>
          </div>
          <ArrowRightIcon className="ml-4 size-5 shrink-0 text-muted-foreground" />
        </Card>
      ) : (
        <Card className="flex flex-col items-center justify-center gap-y-2 bg-transparent p-4 hover:border-ring dark:hover:border-input-active">
          <div className="flex items-center justify-center gap-x-5">
            <SiApollographql className="h-10 w-10" />
            <ChevronDoubleRightIcon className="animation h-8 w-8" />
            <Logo width={50} height={50} />
          </div>
          <p className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-xl font-semibold text-transparent">
            Migrate from Apollo
          </p>
        </Card>
      )}
    </Link>
  );
};
