import { CreateGraphForm } from '@/components/create-graph';
import { FullscreenLayout } from '@/components/layout/fullscreen-layout';
import { MigrateFromApolloForm } from '@/components/migrate-from-apollo-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NextPageWithLayout } from '@/lib/page';
import { HomeIcon } from '@radix-ui/react-icons';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { SiApollographql } from 'react-icons/si';

const tabs = ['federated', 'monograph', 'apollo'] as const;

const tabParser = parseAsStringLiteral(tabs).withDefault('federated');

const titles: Record<(typeof tabs)[number], string> = {
  federated: 'Create Federated Graph',
  monograph: 'Create Monograph',
  apollo: 'Migrate from Apollo',
};

const NewGraphPage: NextPageWithLayout = () => {
  const [tab, setTab] = useQueryState('tab', tabParser);

  return (
    <div>
      <div className="flex h-16 items-center border-b px-4 lg:px-8">
        <Button asChild variant="outline">
          <Link href="/">
            <HomeIcon className="mr-2" /> Home
          </Link>
        </Button>
      </div>
      <div className="mx-auto my-8 max-w-screen-sm px-4 md:px-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof tabs)[number])} className="mb-4 w-max">
          <TabsList>
            <TabsTrigger value="federated">Federated Graph</TabsTrigger>
            <TabsTrigger value="monograph">Monograph</TabsTrigger>
            <TabsTrigger value="apollo" className="gap-x-2">
              <SiApollographql className="size-4" />
              Migrate from Apollo
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Card>
          <CardHeader>
            <CardTitle>{titles[tab]}</CardTitle>
          </CardHeader>
          <CardContent>
            {tab === 'apollo' ? <MigrateFromApolloForm /> : <CreateGraphForm isMonograph={tab === 'monograph'} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

NewGraphPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default NewGraphPage;
