import { GraphContext, GraphPageLayout, getGraphLayout } from '@/components/layout/graph-layout';
import { PageHeader } from '@/components/layout/head';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader } from '@/components/ui/loader';
import { MultiSelect, MultiSelectOption } from '@/components/ui/multi-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useWorkspace } from '@/hooks/use-workspace';
import { parseSchema } from '@/lib/schema-helpers';
import { NextPageWithLayout } from '@/lib/page';
import { callUnaryMethod, useMutation, useQuery, useTransport } from '@connectrpc/connect-query';
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getFederatedGraphSDLByName,
  getGraphResourceOwners,
  getOrganizationGroups,
  getOrganizationMembers,
  getSubgraphSDLFromLatestComposition,
  setGraphResourceOwners,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphResourceOwner } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Kind, isSpecifiedScalarType, parse } from 'graphql';
import { useContext, useMemo, useState } from 'react';

type ResourceKind = 'subgraph' | 'type' | 'override';

interface OwnedResource {
  kind: ResourceKind;
  name: string;
  detail: string;
}

interface ResourceOwners {
  groupIds: string[];
  orgMemberIds: string[];
}

const kindLabels: Record<ResourceKind, string> = {
  subgraph: 'Subgraph',
  type: 'Type',
  override: 'Override',
};

const rootTypeNames = new Set(['Query', 'Mutation', 'Subscription']);

function resourceKey(kind: string, name: string) {
  return `${kind}:${name}`;
}

function typeResources(sdl: string | undefined): OwnedResource[] {
  const parsed = parseSchema(sdl);
  if (!parsed) {
    return [];
  }

  return Object.values(parsed.ast.getTypeMap())
    .filter((type) => !type.name.startsWith('__') && !rootTypeNames.has(type.name) && !isSpecifiedScalarType(type))
    .map((type) => ({ kind: 'type' as const, name: type.name, detail: '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function overrideResources(subgraphName: string, sdl: string | undefined): OwnedResource[] {
  if (!sdl) {
    return [];
  }

  const resources: OwnedResource[] = [];
  try {
    const document = parse(sdl);
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION && definition.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        continue;
      }

      for (const field of definition.fields ?? []) {
        const override = field.directives?.find((directive) => directive.name.value === 'override');
        if (!override) {
          continue;
        }

        const fromArgument = override.arguments?.find((argument) => argument.name.value === 'from');
        const from = fromArgument?.value.kind === Kind.STRING ? fromArgument.value.value : 'another subgraph';
        resources.push({
          kind: 'override',
          name: `${definition.name.value}.${field.name.value}`,
          detail: `${subgraphName} overrides ${from}`,
        });
      }
    }
  } catch {
    return [];
  }

  return resources;
}

function groupOwners(owners: GraphResourceOwner[]): Map<string, ResourceOwners> {
  const ownersByResource = new Map<string, ResourceOwners>();
  for (const owner of owners) {
    const key = resourceKey(owner.resourceKind, owner.resource);
    const entry = ownersByResource.get(key) ?? { groupIds: [], orgMemberIds: [] };
    if (owner.groupId) {
      entry.groupIds.push(owner.groupId);
    }

    if (owner.orgMemberId) {
      entry.orgMemberIds.push(owner.orgMemberId);
    }

    ownersByResource.set(key, entry);
  }

  return ownersByResource;
}

function toSelectedValues(owners: ResourceOwners): string[] {
  return [...owners.groupIds.map((id) => `group:${id}`), ...owners.orgMemberIds.map((id) => `member:${id}`)];
}

function fromSelectedValues(values: string[]): ResourceOwners {
  return {
    groupIds: values.filter((value) => value.startsWith('group:')).map((value) => value.slice('group:'.length)),
    orgMemberIds: values.filter((value) => value.startsWith('member:')).map((value) => value.slice('member:'.length)),
  };
}

function useOwnerOptions(): MultiSelectOption[] {
  const { data: groupsData } = useQuery(getOrganizationGroups);
  const { data: membersData } = useQuery(getOrganizationMembers);

  return useMemo(() => {
    const groupOptions = (groupsData?.groups ?? []).map((group) => ({
      value: `group:${group.groupId}`,
      label: group.name,
      group: 'Groups',
    }));

    const memberOptions = (membersData?.members ?? []).map((member) => ({
      value: `member:${member.orgMemberID}`,
      label: member.email,
      group: 'Members',
    }));

    return [...groupOptions, ...memberOptions];
  }, [groupsData, membersData]);
}

function useGraphResources(graphName: string | undefined, namespace: string, subgraphNames: string[]) {
  const transport = useTransport();

  const { data: graphSdl, isLoading } = useQuery(
    getFederatedGraphSDLByName,
    { name: graphName, namespace },
    { enabled: !!graphName },
  );

  const { data: subgraphSdls } = useTanstackQuery({
    queryKey: ['ownership-subgraph-sdls', graphName, namespace, subgraphNames],
    enabled: !!graphName,
    queryFn: () =>
      Promise.all(
        subgraphNames.map(async (name) => {
          const response = await callUnaryMethod(transport, getSubgraphSDLFromLatestComposition, {
            name,
            fedGraphName: graphName,
            namespace,
          });

          return response.sdl ?? '';
        }),
      ),
  });

  const resources = useMemo(() => {
    const subgraphs: OwnedResource[] = subgraphNames.map((name) => ({ kind: 'subgraph', name, detail: '' }));
    const types = typeResources(graphSdl?.clientSchema || graphSdl?.sdl);

    const overridesByName = new Map<string, OwnedResource>();
    subgraphNames.forEach((name, index) => {
      for (const override of overrideResources(name, subgraphSdls?.[index])) {
        if (!overridesByName.has(override.name)) {
          overridesByName.set(override.name, override);
        }
      }
    });

    return [...subgraphs, ...types, ...overridesByName.values()];
  }, [subgraphNames, graphSdl, subgraphSdls]);

  return { resources, isLoading };
}

function OwnerBadges({ values, options }: { values: string[]; options: MultiSelectOption[] }) {
  if (values.length === 0) {
    return <span className="text-sm text-muted-foreground">No owners</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value} variant="secondary">
          {options.find((option) => option.value === value)?.label ?? 'Unknown'}
        </Badge>
      ))}
    </div>
  );
}

function EditOwnersDialog({
  graphName,
  namespace,
  resource,
  initialValues,
  options,
  onClose,
  onSaved,
}: {
  graphName: string;
  namespace: string;
  resource: OwnedResource;
  initialValues: string[];
  options: MultiSelectOption[];
  onClose(): void;
  onSaved(): Promise<unknown>;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState(initialValues);
  const { mutate, isPending } = useMutation(setGraphResourceOwners);

  const onSaveClick = () => {
    const owners = fromSelectedValues(selected);
    mutate(
      {
        federatedGraphName: graphName,
        namespace,
        resourceKind: resource.kind,
        resource: resource.name,
        groupIds: owners.groupIds,
        orgMemberIds: owners.orgMemberIds,
      },
      {
        onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            onSaved().finally(() => {
              toast({ description: `Owners of ${resource.name} updated`, duration: 3000 });
              onClose();
            });
          } else {
            toast({ description: resp?.response?.details ?? 'Could not update the owners.', duration: 3000 });
          }
        },
        onError() {
          toast({ description: 'Could not update the owners. Please try again.', duration: 3000 });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Owners of {resource.name}</DialogTitle>
          <DialogDescription>
            Owners are asked to approve Hub proposals that change this {kindLabels[resource.kind].toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <MultiSelect
          options={options}
          selected={selected}
          onChange={setSelected}
          placeholder="Add groups or members"
          searchPlaceholder="Search groups and members"
        />

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button isLoading={isPending} onClick={onSaveClick}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OwnershipPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const graphName = graphData?.graph?.name;
  const subgraphNames = useMemo(() => (graphData?.subgraphs ?? []).map((s) => s.name), [graphData?.subgraphs]);

  const { resources, isLoading } = useGraphResources(graphName, namespace, subgraphNames);
  const options = useOwnerOptions();
  const [editing, setEditing] = useState<OwnedResource | null>(null);

  const { data: ownersData, refetch } = useQuery(
    getGraphResourceOwners,
    { federatedGraphName: graphName, namespace },
    { enabled: !!graphName },
  );

  const ownersByResource = useMemo(() => groupOwners(ownersData?.owners ?? []), [ownersData]);

  const selectedValuesOf = (resource: OwnedResource) => {
    const owners = ownersByResource.get(resourceKey(resource.kind, resource.name));
    return owners ? toSelectedValues(owners) : [];
  };

  if (!graphData || isLoading) {
    return <Loader fullscreen />;
  }

  return (
    <div className="flex h-full flex-col gap-y-4">
      <p className="text-sm text-muted-foreground">
        Owners review Hub proposals that touch their subgraphs, types and overridden fields.
      </p>

      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Resource</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="w-full">Owners</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((resource) => (
              <TableRow key={resourceKey(resource.kind, resource.name)}>
                <TableCell>
                  <div className="font-medium">{resource.name}</div>
                  {resource.detail && <div className="text-xs text-muted-foreground">{resource.detail}</div>}
                </TableCell>
                <TableCell>{kindLabels[resource.kind]}</TableCell>
                <TableCell>
                  <OwnerBadges values={selectedValuesOf(resource)} options={options} />
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => setEditing(resource)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      {editing && graphName && (
        <EditOwnersDialog
          graphName={graphName}
          namespace={namespace}
          resource={editing}
          initialValues={selectedValuesOf(editing)}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
};

OwnershipPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Ownership | Studio">
      <GraphPageLayout title="Ownership" subtitle="Owners of the subgraphs, types and overrides of this graph">
        {page}
      </GraphPageLayout>
    </PageHeader>,
  );

export default OwnershipPage;
