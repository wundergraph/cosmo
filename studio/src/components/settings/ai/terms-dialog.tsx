import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Button } from '@/components/ui/button';
import { Organization } from '@/components/app-provider';
import { COSMO_AI_TERMS_OF_SERVICE_MARKDOWN } from './cosmo-ai-terms-of-service';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { acceptFeatureTerms } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useMutation } from '@connectrpc/connect-query';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useToast } from '@/components/ui/use-toast';

export type TermsDialogProps = {
  open: boolean;
  feature: Feature;
  isPending: boolean;
  organization: Organization;
  onCloseDialog(): void;
  onTermsAccepted(): void;
};

export function TermsDialog({
  open,
  feature,
  isPending,
  organization,
  onCloseDialog,
  onTermsAccepted,
}: TermsDialogProps) {
  const { mutate, isPending: isAcceptingFeatureTerms } = useMutation(acceptFeatureTerms);
  const { toast } = useToast();

  const onDialogOpenChange = (_: boolean) => {
    if (isPending || isAcceptingFeatureTerms) {
      // Prevent closing the dialog when the operation is pending
      return;
    }

    onCloseDialog();
  };

  const handleAcceptTerms = () => {
    if (isPending || isAcceptingFeatureTerms) {
      return;
    }

    mutate(
      { featureId: organization.acceptedFeatureTerms.length === 0 ? undefined : feature },
      {
        onSuccess(d) {
          if (d.response?.code === EnumStatusCode.OK) {
            onTermsAccepted();
          } else {
            toast({
              description: 'Failed to accept the terms for the feature.',
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: 'Failed to accept the terms for the feature.',
            duration: 3000,
          });
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="max-w-screen-md">
        <div className="mt-3 h-full max-h-[calc(100vh_-_12rem)]">
          <div className="scrollbar-custom prose-pre:scrollbar-custom prose h-full !max-w-full overflow-auto overflow-y-auto dark:prose-invert prose-code:bg-secondary prose-pre:!bg-secondary/50">
            <SafeMarkdown content={COSMO_AI_TERMS_OF_SERVICE_MARKDOWN} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={isPending || isAcceptingFeatureTerms}
            onClick={() => onDialogOpenChange(false)}
          >
            Close
          </Button>

          <Button isLoading={isPending || isAcceptingFeatureTerms} onClick={handleAcceptTerms}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
