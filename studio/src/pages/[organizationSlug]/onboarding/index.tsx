import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function OnboardingIndex() {
  const router = useRouter();
  const slug = router.query.organizationSlug as string;

  useEffect(() => {
    if (slug) {
      router.replace(`/${slug}/onboarding/welcome`);
    }
  }, [router, slug]);

  return null;
}
