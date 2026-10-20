import { SessionClientContext } from '@/components/app-provider';
import { updateFeatureSettings } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useToast } from '@/components/ui/use-toast';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useMutation } from '@connectrpc/connect-query';
import { useRouter } from 'next/router';
import { useCallback, useContext } from 'react';

export function useUpdateFeatureSettings(featureId: Feature, onComplete?: (success: boolean) => void) {
  const router = useRouter();
  const sessionQueryClient = useContext(SessionClientContext);
  const { mutate, isPending } = useMutation(updateFeatureSettings);
  const { toast } = useToast();

  const enable = useCallback(() => {
    mutate(
      { enable: true, featureId },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });

            onComplete?.(true);
            toast({
              description: 'Feature enabled successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            onComplete?.(false);
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          onComplete?.(false);
          toast({
            description: 'Could not enable the feature. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  }, [mutate, featureId, sessionQueryClient, router.asPath, onComplete, toast]);

  const disable = useCallback(() => {
    mutate(
      { enable: false, featureId },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Feature disabled successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not disable the feature. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  }, [mutate, featureId, router.asPath, sessionQueryClient, toast]);

  return { enable, disable, isPending };
}
