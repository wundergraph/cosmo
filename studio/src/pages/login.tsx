import {
  AuthCard,
  AuthLogoHeader,
  AuthFooter,
  TrustedCompanies,
  ProductCosmoStack,
} from "@/components/auth/auth-components";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Button } from "@/components/ui/button";
import { NextPageWithLayout } from "@/lib/page";
import { ArrowRightIcon, GitHubLogoIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { FaGoogle } from "react-icons/fa";
import { BsBuildingLock } from "react-icons/bs";
import { useEffect } from "react";
import { z } from "zod";
import useCookie from "@/hooks/use-cookie";

const loginUrl = `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login`;

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
  const q = new URLSearchParams();

  if (redirectURL) q.append("redirectURL", redirectURL);
  if (provider) q.append("provider", provider);
  if (sso) q.append("sso", sso);

  const queryString = q.toString();

  return loginUrl + (queryString.length ? "?" + queryString : "");
};

// Button height: 56px / 900px = 6.2%
const buttonHeightStyle = { height: "clamp(48px, 6.2vh, 56px)" };

const LoginPage: NextPageWithLayout = () => {
  const router = useRouter();

  const { redirectURL, sso } = querySchema.parse(router.query);

  const [cosmoIdpHintCookieValue] = useCookie("cosmo_idp_hint");

  useEffect(() => {
    if (!router.isReady || sso) return;
    if (cosmoIdpHintCookieValue) {
      router.replace(`/login?sso=${cosmoIdpHintCookieValue}`);
    }
  }, [cosmoIdpHintCookieValue, sso, router]);

  return (
    <div className="flex min-h-full flex-col">
      {/* Main content area - two columns */}
      <div className="flex flex-1 items-center justify-center px-4 py-8 lg:px-0 lg:py-0">
        <div className="flex w-full max-w-screen-2xl flex-col lg:flex-row">
          {/* Left section */}
          <div className="flex w-full flex-col items-center justify-center lg:w-1/2 lg:p-12">
            <div className="w-full max-w-md lg:max-w-lg">
              <AuthCard className="w-full rounded-xl px-6 py-8 lg:px-10 lg:py-12">
                <AuthLogoHeader />

                <div className="mt-8 lg:mt-12">
                  <h2 className="text-2xl font-normal leading-[120%] text-white lg:text-[32px]">
                    Log in
                  </h2>

                  <div className="mt-6 space-y-3 lg:mt-8 lg:space-y-4">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                    asChild
                  >
                    <Link
                      href={constructLoginURL({ redirectURL, provider: "github" })}
                    >
                      <GitHubLogoIcon className="mr-3 h-5 w-5 lg:mr-4 lg:h-6 lg:w-6" />
                      Log in with GitHub
                    </Link>
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                    asChild
                  >
                    <Link
                      href={constructLoginURL({ redirectURL, provider: "google" })}
                    >
                      <FaGoogle className="mr-3 h-5 w-5 lg:mr-4 lg:h-6 lg:w-6" />
                      Log in with Google
                    </Link>
                  </Button>

                  {sso && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                      asChild
                    >
                      <Link href={constructLoginURL({ redirectURL, sso })}>
                        <BsBuildingLock className="mr-3 h-5 w-5 lg:mr-4 lg:h-6 lg:w-6" />
                        Log in with SSO
                      </Link>
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="lg"
                    className="group h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                    asChild
                  >
                    <Link href={constructLoginURL({ redirectURL })}>
                      Continue with Email
                      <ArrowRightIcon className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1 lg:ml-3 lg:h-5 lg:w-5" />
                    </Link>
                  </Button>
                </div>

                {/* Divider line */}
                <div className="mt-7 mb-6 h-px w-full bg-white/10" />

                <p className="text-center text-sm text-gray-400">
                  Don&apos;t have an account?
                  <Link
                    href={
                      redirectURL ? `/signup?redirectURL=${redirectURL}` : "/signup"
                    }
                    className="ml-[5px] font-medium text-primary hover:underline"
                  >
                    Sign Up
                  </Link>
                </p>
              </div>
            </AuthCard>

              {/* Trusted companies */}
              <div className="mt-8 lg:mt-16">
                <TrustedCompanies />
              </div>
            </div>
          </div>

        {/* Right section */}
          <div className="hidden w-1/2 flex-col items-start 
          justify-center pb-28 px-14 pt-12 lg:flex">
            <ProductCosmoStack variant="login" />
          </div>
        </div>
      </div>

      {/* Footer */}
      <AuthFooter />
    </div>
  );
};

LoginPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default LoginPage;
