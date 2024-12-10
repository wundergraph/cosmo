// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Koala, Reo

declare global {
  interface Window {
    ko: any;
    Reo: any;
  }
}

const resetKoala = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.ko?.reset;
};

const identify = ({
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
  if (typeof window === "undefined") {
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    return;
  }

  window.ko?.identify(email, {
    id,
    $account: {
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    },
  });

  window.Reo?.identify({
    username: email,
    type: "email",
  });
};

export { resetKoala, identify };
