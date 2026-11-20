import { useEffect, useState } from 'react';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { HubAiSettings } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  getHubAiSettings,
  updateHubAiSettings,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { NextPageWithLayout } from '@/lib/page';

const MODEL_TARGETS = [
  { target: 'schema-change', label: 'Schema change' },
  { target: 'connect-api', label: 'Connect an API' },
  { target: 'implement-subgraph', label: 'Implement subgraph resolvers' },
  { target: 'router-upgrade', label: 'Router upgrade' },
  { target: 'fix-checks', label: 'Fix failing checks' },
  { target: 'ask-ai', label: 'Ask AI' },
];

type Form = {
  managed: boolean;
  agentsEnabled: boolean;
  defaultModel: string;
  models: Record<string, string>;
  monthlyCapUsd: string;
  memberMonthlyCapUsd: string;
  repositoriesRestricted: boolean;
  repositories: string;
  hostsRestricted: boolean;
  hosts: string;
  agentHiddenTags: string;
};

const toForm = (settings: HubAiSettings | undefined): Form => {
  return {
    managed: settings !== undefined,
    agentsEnabled: !settings?.agentsDisabled,
    defaultModel: settings?.defaultModel ?? '',
    models: Object.fromEntries((settings?.modelOverrides ?? []).map(({ target, model }) => [target, model])),
    monthlyCapUsd: settings?.monthlyCapUsd?.toString() ?? '',
    memberMonthlyCapUsd: settings?.memberMonthlyCapUsd?.toString() ?? '',
    repositoriesRestricted: settings?.repositories?.restricted ?? false,
    repositories: (settings?.repositories?.entries ?? []).join('\n'),
    hostsRestricted: settings?.hosts?.restricted ?? false,
    hosts: (settings?.hosts?.entries ?? []).join('\n'),
    agentHiddenTags: (settings?.agentHiddenTags ?? ['internal', 'pii']).join(', '),
  };
};

const lines = (text: string) => {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const cap = (text: string) => {
  return text.trim() === '' ? undefined : Number(text);
};

const HubAiPage: NextPageWithLayout = () => {
  const isAdmin = useIsAdmin();
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery(getHubAiSettings, {});
  const { mutate, isPending } = useMutation(updateHubAiSettings);
  const [form, setForm] = useState<Form>(toForm(undefined));

  useEffect(() => {
    if (data) {
      setForm(toForm(data.settings));
    }
  }, [data]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<InfoCircledIcon className="h-12 w-12" />}
        title="You don't have access"
        description="You need organization admin access to manage Hub AI settings."
      />
    );
  }

  if (isLoading) {
    return <Loader fullscreen />;
  }

  const update = (patch: Partial<Form>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const save = () => {
    mutate(
      {
        settings: form.managed
          ? {
              agentsDisabled: !form.agentsEnabled,
              defaultModel: form.defaultModel,
              modelOverrides: Object.entries(form.models)
                .filter(([, model]) => model.trim() !== '')
                .map(([target, model]) => ({ target, model })),
              monthlyCapUsd: cap(form.monthlyCapUsd),
              memberMonthlyCapUsd: cap(form.memberMonthlyCapUsd),
              repositories: { restricted: form.repositoriesRestricted, entries: lines(form.repositories) },
              hosts: { restricted: form.hostsRestricted, entries: lines(form.hosts) },
              agentHiddenTags: lines(form.agentHiddenTags),
            }
          : undefined,
      },
      {
        onSuccess: (answer) => {
          if (answer.response?.code === EnumStatusCode.OK) {
            toast({ description: 'Hub AI settings saved. Hub follows within seconds.', duration: 3000 });
            refetch();
          } else {
            toast({ description: answer.response?.details ?? 'Could not save the Hub AI settings.', duration: 3000 });
          }
        },
        onError: () => {
          toast({ description: 'Could not save the Hub AI settings. Please try again.', duration: 3000 });
        },
      },
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Manage in Cosmo</CardTitle>
            <CardDescription>
              While on, Hub follows these settings and its admins cannot change them there. Off hands them back to Hub
              with the values below.
            </CardDescription>
          </div>
          <Switch checked={form.managed} onCheckedChange={(managed) => update({ managed })} />
        </CardHeader>
      </Card>

      <fieldset disabled={!form.managed} className="flex flex-col gap-y-6 disabled:opacity-60">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Agents</CardTitle>
              <CardDescription>Off stops agent runs and Ask AI in Hub, running ones included.</CardDescription>
            </div>
            <Switch checked={form.agentsEnabled} onCheckedChange={(agentsEnabled) => update({ agentsEnabled })} />
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>
              Empty fields use the default model; an empty default uses the Hub deployment&apos;s model.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4 gap-y-3">
            <Label htmlFor="default-model">Default model</Label>
            <Input
              id="default-model"
              placeholder="google/gemini-3.1-flash-lite"
              value={form.defaultModel}
              onChange={(event) => update({ defaultModel: event.target.value })}
            />
            {MODEL_TARGETS.map(({ target, label }) => (
              <div key={target} className="contents">
                <Label htmlFor={`model-${target}`}>{label}</Label>
                <Input
                  id={`model-${target}`}
                  placeholder="Default model"
                  value={form.models[target] ?? ''}
                  onChange={(event) => update({ models: { ...form.models, [target]: event.target.value } })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly spending caps</CardTitle>
            <CardDescription>In USD. Empty means no cap. Runs pause when a cap is reached.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4 gap-y-3">
            <Label htmlFor="monthly-cap">Organization</Label>
            <Input
              id="monthly-cap"
              type="number"
              min={0}
              value={form.monthlyCapUsd}
              onChange={(event) => update({ monthlyCapUsd: event.target.value })}
            />
            <Label htmlFor="member-monthly-cap">Per member</Label>
            <Input
              id="member-monthly-cap"
              type="number"
              min={0}
              value={form.memberMonthlyCapUsd}
              onChange={(event) => update({ memberMonthlyCapUsd: event.target.value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where agents may work</CardTitle>
            <CardDescription>
              Off lets agent runs use every connected repository and every allowlisted host. On limits them to the
              entries, one per line.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-y-4">
            <div className="flex items-center justify-between">
              <Label>Only these repositories (owner/name) get pull requests</Label>
              <Switch
                checked={form.repositoriesRestricted}
                onCheckedChange={(repositoriesRestricted) => update({ repositoriesRestricted })}
              />
            </div>
            {form.repositoriesRestricted && (
              <Textarea
                placeholder="acme/payments"
                value={form.repositories}
                onChange={(event) => update({ repositories: event.target.value })}
              />
            )}
            <div className="flex items-center justify-between">
              <Label>Only these allowlisted hosts are reachable</Label>
              <Switch
                checked={form.hostsRestricted}
                onCheckedChange={(hostsRestricted) => update({ hostsRestricted })}
              />
            </div>
            {form.hostsRestricted && (
              <Textarea
                placeholder="api.stripe.com"
                value={form.hosts}
                onChange={(event) => update({ hosts: event.target.value })}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hidden from agents</CardTitle>
            <CardDescription>
              Contract tags whose schema agents never see, unless a group&apos;s view_hidden_schema grant shows them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="internal, pii"
              value={form.agentHiddenTags}
              onChange={(event) => update({ agentHiddenTags: event.target.value })}
            />
          </CardContent>
        </Card>
      </fieldset>

      <div>
        <Button onClick={save} isLoading={isPending}>
          Save
        </Button>
      </div>
    </div>
  );
};

HubAiPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    'Hub AI',
    'Agents, models, spending caps and where agents may work in WunderGraph Hub.',
  );
};

export default HubAiPage;
