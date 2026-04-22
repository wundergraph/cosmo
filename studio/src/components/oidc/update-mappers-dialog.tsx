import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { GroupMapper } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  updateIDPMappers,
  getOrganizationGroups,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { CgSpinner } from 'react-icons/cg';
import { OIDCGroupMapper, MapperInput, schema } from './oidc-group-mapper';
import { PlusIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useToast } from '@/components/ui/use-toast';

export interface UpdateMappersDialogProps {
  forceOpen: boolean;
  isProviderConnected: boolean;
  currentMappers: GroupMapper[];
  refetch(): Promise<unknown>;
  onClose(): void;
}

export function UpdateMappersDialog({
  forceOpen,
  isProviderConnected,
  currentMappers,
  refetch,
  onClose,
}: UpdateMappersDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  const [mappers, setMappers] = useState<MapperInput[]>([]);
  const { toast } = useToast();

  const { mutate } = useMutation(updateIDPMappers);
  const {
    data: organizationGroups,
    isLoading,
    isError,
    refetch: refetchOrganizationGroups,
  } = useQuery(
    getOrganizationGroups,
    {},
    {
      enabled: open,
    },
  );

  const hasInvalidMappers = mappers.some((mapper) => !schema.safeParse(mapper).success);
  const onOpenChangeCallback = (open: boolean) => {
    if ((isPending || mappers.length === 0 || (mappers.length === 1 && hasInvalidMappers)) && !open) {
      return;
    }

    setOpen(open);
    if (!open) {
      onClose();
    }
  };

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setPending(false);
    }
  }, [forceOpen]);

  useEffect(() => {
    if (open) {
      setPending(false);
      setMappers(
        currentMappers.map((mapper, index) => ({
          id: `${Date.now().toString()}-${index}`,
          ...mapper,
        })),
      );
    }
  }, [open, currentMappers]);

  const updateMappers = () => {
    if (isPending) {
      return;
    }

    setPending(true);
    mutate(
      { mappers },
      {
        onSuccess(data) {
          if (data.response?.code === EnumStatusCode.OK) {
            toast({
              description: 'Group mappers updated successfully.',
              duration: 4000,
            });

            refetch().finally(() => {
              setOpen(false);
              onClose();
            });
          } else {
            setPending(false);
            toast({
              description: data.response?.details ?? 'Could not update the group mappers. Please try again.',
              duration: 4000,
            });
          }
        },
        onError() {
          setPending(false);
          toast({
            description: 'Could not update the group mappers. Please try again.',
            duration: 4000,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChangeCallback}>
      {isProviderConnected && (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-x-2">
            {currentMappers.length === 0 && <ExclamationTriangleIcon className="size-4 text-warning" />}
            <span>Update Mappers</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update group mappers</DialogTitle>
          <DialogDescription>Map your groups to cosmo groups.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 justify-between gap-x-2 px-1 text-sm font-bold">
          <span>Group in Cosmo</span>
          <span>Group in the provider</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-1">
            <CgSpinner className="size-6 animate-spin" />
          </div>
        ) : isError || !organizationGroups?.groups ? (
          <div className="flex flex-col items-center justify-start gap-y-2 p-1 text-sm text-destructive">
            <div>Failed to retrieve the groups for the organization.</div>
            <div>
              <Button variant="secondary" onClick={() => void refetchOrganizationGroups()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-h-[35vh] space-y-3">
              {mappers.length === 0 ? (
                <div className="px-1 py-2 text-center text-sm text-muted-foreground">No mappers have been added.</div>
              ) : (
                mappers.map((mapper, index) => (
                  <OIDCGroupMapper
                    key={mapper.id}
                    mapper={mapper}
                    availableGroups={organizationGroups?.groups ?? []}
                    isPending={isPending}
                    onChange={(updatedMapper) => {
                      const updatedMappers = [...mappers];
                      updatedMappers[index] = updatedMapper;
                      setMappers(updatedMappers);
                    }}
                    onRemove={() => {
                      const updatedMappers = [...mappers];
                      updatedMappers.splice(index, 1);
                      setMappers(updatedMappers);
                    }}
                  />
                ))
              )}
            </div>

            <div>
              <Button
                variant="outline"
                className="gap-x-2"
                disabled={hasInvalidMappers || isPending}
                onClick={() => {
                  setMappers((current) => [...current, { id: Date.now().toString(), groupId: '', ssoGroup: '' }]);
                }}
              >
                <PlusIcon />
                <span>{mappers.length === 0 ? 'Add' : 'Add Another'}</span>
              </Button>
            </div>
          </>
        )}

        <Button
          type="button"
          variant="default"
          size="lg"
          isLoading={isPending}
          disabled={mappers.length === 0 || hasInvalidMappers || isPending}
          onClick={updateMappers}
        >
          Update
        </Button>
      </DialogContent>
    </Dialog>
  );
}
