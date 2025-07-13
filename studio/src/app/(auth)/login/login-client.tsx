"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useCookie from "@/hooks/use-cookie";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, GitHubLogoIcon } from "@radix-ui/react-icons";
import { FaGoogle } from "react-icons/fa";
import { BsBuildingLock } from "react-icons/bs";
import Link from "next/link";
import { z } from "zod";
import Divider from "../_components/divider";

const querySchema = z.object({
  redirectURL: z.string().url().optional(),
  sso: z.string().optional(),
});

const constructLoginURL = ({
  redirectURL,
  sso,
  provider,
}: {
  redirectURL?: string;
  provider?: string;
  sso?: string;
}) => {
  const url = new URL(`${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login`);

  if (redirectURL) url.searchParams.set("redirectURL", redirectURL);
  if (provider) url.searchParams.set("provider", provider);
  if (sso) url.searchParams.set("sso", sso);

  return url.toString();
};

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cosmoIdpHintCookieValue] = useCookie("cosmo_idp_hint");
  
  // Parse search params directly
  const params = searchParams ? Object.fromEntries(searchParams.entries()) : {};
  const { redirectURL, sso } = querySchema.parse(params);

  // Handle SSO cookie redirect
  useEffect(() => {
    if (searchParams && !sso && cosmoIdpHintCookieValue) {
      const currentParams = new URLSearchParams(searchParams.toString());
      currentParams.set("sso", cosmoIdpHintCookieValue);
      router.replace(`/login?${currentParams.toString()}`);
    }
  }, [searchParams, sso, cosmoIdpHintCookieValue, router]);

  return (
    <div className="mt-12 space-y-4">
      <Button
        variant="outline"
        size="lg"
        className="text-md w-full px-12 py-6"
        asChild
      >
        <Link href={constructLoginURL({ redirectURL, provider: "github" })}>
          <GitHubLogoIcon className="me-2" />
          Sign in with GitHub
        </Link>
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="text-md w-full truncate px-12 py-6"
        asChild
      >
        <Link href={constructLoginURL({ redirectURL, provider: "google" })}>
          <FaGoogle className="me-2" />
          Sign in with Google
        </Link>
      </Button>
      {sso ? (
        <Button
          variant="outline"
          size="lg"
          className="text-md w-full truncate px-12 py-6"
          asChild
        >
          <Link
            href={constructLoginURL({ redirectURL, sso })}
            className="flex gap-x-2"
          >
            <BsBuildingLock className="h-5 w-5" />
            Sign in with SSO
          </Link>
        </Button>
      ) : null}

      <Divider />

      <Button
        variant="outline"
        size="lg"
        className="text-md group w-full truncate px-12 py-6"
        asChild
      >
        <Link href={constructLoginURL({ redirectURL })}>
          Continue with Email{" "}
          <ArrowRightIcon className="ms-2 transition-all group-hover:translate-x-1" />
        </Link>
      </Button>
    </div>
  );
} 
