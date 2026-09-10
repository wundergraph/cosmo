import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { Button } from '@/components/ui/button';
import { useUpdateFeatureSettings } from './use-update-feature-settings';
import { FaMagic, FaSpinner } from 'react-icons/fa';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Link from 'next/link';
import { docsBaseURL } from '@/lib/constants';
import { ReactNode, useState } from 'react';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  COSMO_AI_TERMS_OF_SERVICE_MARKDOWN,
  COSMO_AI_TERMS_OF_SERVICE_REVISION_DATE,
} from './cosmo-ai-terms-of-service';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Checkbox } from '@/components/ui/checkbox';
import { Organization } from '@/components/app-provider';
import { acceptFeatureTerms } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useMutation } from '@connectrpc/connect-query';
import { parseJSON, startOfDay, isBefore } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';

type SimpleSegmentProps = {
  organization: Organization;
};

type SegmentProps = {
  children: ReactNode;
  organization: Organization;
  feature: Feature;
  isEnabled: boolean;
  docsLink?: string;
};

export function CosmoAi() {
  const organization = useCurrentOrganization();
  if (!organization) {
    return null;
  }

  return (
    <Card className="pb-3">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="flex items-center gap-x-2">
          <FaMagic />
          <span>Cosmo AI</span>
          <Badge variant="outline">Beta</Badge>
        </CardTitle>
      </CardHeader>

      <CosmoAiSegment organization={organization} />
      <PtQSegment organization={organization} />
    </Card>
  );
}

function getFeatureId(feature: Feature): string | undefined {
  switch (feature) {
    case Feature.ai: {
      return 'ai';
    }
    case Feature.promptToQuery: {
      return 'prompt-to-query';
    }
  }

  return undefined;
}

function shouldReacceptTermsForFeature(acceptedAt: string | undefined): boolean {
  if (!acceptedAt) {
    return true;
  }

  try {
    const parsed = startOfDay(parseJSON(acceptedAt));
    return isBefore(parsed, COSMO_AI_TERMS_OF_SERVICE_REVISION_DATE);
  } catch {
    return true;
  }
}

function Segment({ children, organization, feature, isEnabled, docsLink }: SegmentProps) {
  const [showAcceptTermsDialog, setShowAcceptTermsDialog] = useState(false);
  const { mutate, isPending: isAcceptingFeatureTerms } = useMutation(acceptFeatureTerms);
  const {
    enable,
    disable,
    isPending: isUpdatingFeatureSettings,
  } = useUpdateFeatureSettings(feature, () => {
    setShowAcceptTermsDialog(false);
  });

  const { toast } = useToast();

  const featureId = getFeatureId(feature);
  const isPending = isUpdatingFeatureSettings || isAcceptingFeatureTerms;
  const featureAcceptance = organization.acceptedFeatureTerms.find((aft) => aft.featureId === featureId);
  const needsToAcceptTermsForFeature =
    !featureAcceptance || shouldReacceptTermsForFeature(featureAcceptance.lastAcceptedAt);

  const onDialogOpenChange = (open: boolean) => {
    if (isPending) {
      // Prevent closing the dialog when the operation is pending
      return;
    }

    setShowAcceptTermsDialog(open);
  };

  const handleAcceptTerms = () => {
    if (!needsToAcceptTermsForFeature) {
      isEnabled ? disable() : enable();
      return;
    }

    mutate(
      { featureId: organization.acceptedFeatureTerms.length === 0 ? undefined : feature },
      {
        onSuccess(d) {
          if (d.response?.code === EnumStatusCode.OK) {
            enable();
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
    <>
      <div
        className="flex cursor-pointer items-center justify-between border-t border-accent px-6 py-3 hover:bg-muted"
        onClick={() => {
          if (isPending) {
            // Prevent double-submitting the operation
            return;
          }

          if (isEnabled) {
            disable();
          } else {
            if (needsToAcceptTermsForFeature) {
              setShowAcceptTermsDialog(true);
            } else {
              enable();
            }
          }
        }}
      >
        <div>
          <div className="pointer-events-none">{children}</div>
          {docsLink && (
            <Link href={docsLink} className="text-sm text-primary" target="_blank" rel="noreferrer">
              Learn more
            </Link>
          )}
        </div>

        {isPending ? (
          <FaSpinner className="animated animate-spin opacity-75" />
        ) : (
          <Checkbox className="pointer-events-none" checked={isEnabled} />
        )}
      </div>

      <Dialog open={showAcceptTermsDialog} onOpenChange={onDialogOpenChange}>
        <DialogContent className="max-w-screen-md">
          <div className="mt-3 h-full max-h-[calc(100vh_-_12rem)]">
            <div className="scrollbar-custom prose-pre:scrollbar-custom prose h-full !max-w-full overflow-auto overflow-y-auto dark:prose-invert prose-code:bg-secondary prose-pre:!bg-secondary/50">
              <SafeMarkdown content={COSMO_AI_TERMS_OF_SERVICE_MARKDOWN} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={isPending} onClick={() => onDialogOpenChange(false)}>
              Close
            </Button>

            <Button isLoading={isPending} onClick={handleAcceptTerms}>
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CosmoAiSegment({ organization }: SimpleSegmentProps) {
  const isFeatureEnabled = organization.features.find((f) => f.id === 'ai')?.enabled;

  return (
    <Segment
      organization={organization}
      feature={Feature.ai}
      isEnabled={isFeatureEnabled ?? false}
      docsLink={docsBaseURL + '/studio/cosmo-ai'}
    >
      Enable generative AI to create documentation for your GraphQL schema or fix queries.
    </Segment>
  );
}

function PtQSegment({ organization }: SimpleSegmentProps) {
  const feature = organization.features.find((f) => f.id === 'prompt-to-query');
  const isFeatureEnabled = feature?.enabled;
  if (!feature) {
    return null;
  }

  return (
    <Segment organization={organization} feature={Feature.promptToQuery} isEnabled={isFeatureEnabled ?? false}>
      Prompt-to-Query
    </Segment>
  );
}
