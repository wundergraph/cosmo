// Koala integration. This will be available if koala script is embedded though CUSTOM_HEAD_SCRIPTS env

declare global {
  interface Window {
    ko: any;
  }
}

const resetKoala = () => window.ko?.reset;

const identifyKoala = ({
  email,
  id,
  organizationId,
  organizationName,
  organizationSlug,
  plan,
}: {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan?: string;
}) => {
  window.ko?.identify(email, {
    id,
    $account: {
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    },
  });
};

export { resetKoala, identifyKoala };
