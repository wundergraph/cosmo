import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useStarBannerDisabled } from '@/hooks/use-star-banner-disabled';

// Number of banners stacked above the dashboard (star banner and organization banner),
// used to offset the layout heights.
export function useBannerCount(): number {
  const org = useCurrentOrganization();
  const [isStarBannerDisabled] = useStarBannerDisabled();

  const isOrganizationBannerDisplayed = !!org?.deactivation || !!org?.deletion || !!org?.billing?.isBillDue;

  return Number(isOrganizationBannerDisplayed) + Number(!isStarBannerDisabled);
}
