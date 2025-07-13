"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, GitHubLogoIcon } from "@radix-ui/react-icons";
import { FaGoogle } from "react-icons/fa";
import Link from "next/link";
import { z } from "zod";
import Divider from "../_components/divider";

const querySchema = z.object({
  redirectURL: z.string().url().optional(),
});

const constructSignupURL = ({
  redirectURL,
  provider,
}: {
  redirectURL?: string;
  provider?: string;
}) => {
  const url = new URL(
    `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/signup`,
  );

  if (redirectURL) url.searchParams.set("redirectURL", redirectURL);
  if (provider) url.searchParams.set("provider", provider);

  return url.toString();
};

export default function SignupClient() {
  const searchParams = useSearchParams();

  // Parse search params directly
  const params = searchParams ? Object.fromEntries(searchParams.entries()) : {};
  const { redirectURL } = querySchema.parse(params);

  return (
    <div className="mt-12 space-y-4">
      <Button
        variant="outline"
        size="lg"
        className="text-md w-full truncate px-12 py-6"
        asChild
      >
        <Link
          href={constructSignupURL({
            redirectURL,
            provider: "github",
          })}
        >
          <GitHubLogoIcon className="me-2" />
          Sign up with GitHub
        </Link>
      </Button>

      <Button
        variant="outline"
        size="lg"
        className="text-md w-full truncate px-12 py-6"
        asChild
      >
        <Link
          href={constructSignupURL({
            redirectURL,
            provider: "google",
          })}
        >
          <FaGoogle className="me-2" />
          Sign up with Google
        </Link>
      </Button>

      <Divider />

      <Button
        variant="outline"
        size="lg"
        className="text-md group w-full truncate px-12 py-6"
        asChild
      >
        <Link href={constructSignupURL({ redirectURL })}>
          Continue with Email{" "}
          <ArrowRightIcon className="ms-2 transition-all group-hover:translate-x-1" />
        </Link>
      </Button>
    </div>
  );
}
