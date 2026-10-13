import { ReactNode, useState } from 'react';
import { Organization } from '@/components/app-provider';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useUpdateFeatureSettings } from '@/components/settings/use-update-feature-settings';
import { Link } from '@/components/ui/link';
import { FaSpinner } from 'react-icons/fa';
import { Checkbox } from '@/components/ui/checkbox';
import { TermsDialog } from './terms-dialog';
import { isBefore, parseJSON, startOfDay } from 'date-fns';
import { COSMO_AI_TERMS_OF_SERVICE_REVISION_DATE } from './cosmo-ai-terms-of-service';

export type SimpleAiSegmentProps = {
  organization: Organization;
};

export type AiSegmentProps = {
  children: ReactNode;
  organization: Organization;
  feature: Feature;
  isEnabled: boolean;
  docsLink?: string;
};

export function AiSegment({ children, organization, feature, isEnabled, docsLink }: AiSegmentProps) {
  const [showAcceptTermsDialog, setShowAcceptTermsDialog] = useState(false);
  const { enable, disable, isPending } = useUpdateFeatureSettings(feature, () => {
    setShowAcceptTermsDialog(false);
  });

  const featureId = getFeatureId(feature);
  const featureAcceptance = organization.acceptedFeatureTerms.find((aft) => aft.featureId === featureId);
  const needsToAcceptTermsForFeature =
    !featureAcceptance || shouldReacceptTermsForFeature(featureAcceptance.lastAcceptedAt);

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

      <TermsDialog
        open={showAcceptTermsDialog}
        feature={feature}
        isPending={isPending}
        organization={organization}
        onCloseDialog={() => setShowAcceptTermsDialog(false)}
        onTermsAccepted={() => (isEnabled ? disable() : enable())}
      />
    </>
  );
}

function getFeatureId(feature: Feature): 'ai' | 'prompt-to-query' | undefined {
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
