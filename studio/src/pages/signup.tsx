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
import { z } from "zod";

const signupUrl = `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/signup`;

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
  const q = new URLSearchParams();

  if (redirectURL) q.append("redirectURL", redirectURL);
  if (provider) q.append("provider", provider);

  const queryString = q.toString();

  return signupUrl + (queryString.length ? "?" + queryString : "");
};

const SignupPage: NextPageWithLayout = () => {
  const router = useRouter();

  const { redirectURL } = querySchema.parse(router.query);

  return (
    <div className="flex min-h-full flex-col">
      {/* Main content area */}
      <div className="flex flex-1 items-center justify-center px-4 py-8 lg:px-0 lg:py-0">
        <div className="flex w-full max-w-screen-2xl flex-col lg:flex-row">
          {/* Left section - Marketing */}
          <div className="flex w-full flex-col items-center justify-center px-4 py-10 lg:min-h-screen lg:w-1/2 lg:items-start lg:px-14 lg:pb-28 lg:pt-12">
            <div className="lg:mt-8">
              <ProductCosmoStack variant="signup" />
            </div>
          </div>

          {/* Right section - Form */}
          <div className="flex w-full flex-col items-center justify-center pb-10 lg:min-h-screen lg:w-1/2 lg:p-12">
            <div className="w-full max-w-md lg:max-w-lg">
              <AuthCard className="w-full rounded-xl px-6 py-8 lg:px-10 lg:py-12">
                <div className="hidden lg:block">
                  <AuthLogoHeader />
                </div>

                <div className="mt-8 lg:mt-12">
                  <h2 className="text-center text-2xl font-normal leading-[120%] text-white lg:text-[32px]">
                    Sign up for free
                  </h2>
                  <p className="mt-2 text-center text-sm text-white/85 lg:text-base">
                    Try Cosmo as Managed Service. No card required.
                  </p>

                  <div className="mt-6 space-y-3 lg:mt-8 lg:space-y-4">
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                      asChild
                    >
                      <Link
                        href={constructSignupURL({ redirectURL, provider: "github" })}
                      >
                        <GitHubLogoIcon className="mr-3 h-5 w-5 lg:mr-4 lg:h-6 lg:w-6" />
                        Sign up with GitHub
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      className="h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                      asChild
                    >
                      <Link
                        href={constructSignupURL({ redirectURL, provider: "google" })}
                      >
                        <FaGoogle className="mr-3 h-5 w-5 lg:mr-4 lg:h-6 lg:w-6" />
                        Sign up with Google
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      className="group h-12 w-full rounded-lg border-white/25 bg-transparent text-sm text-white hover:bg-white/15 lg:h-14 lg:text-base"
                      asChild
                    >
                      <Link href={constructSignupURL({ redirectURL })}>
                        Continue with Email
                        <ArrowRightIcon className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1 lg:ml-3 lg:h-5 lg:w-5" />
                      </Link>
                    </Button>
                  </div>

                  {/* Divider line */}
                  <div className="mb-6 mt-7 h-px w-full bg-white/10" />

                  <p className="text-center text-sm text-gray-400">
                    Already have an account?
                    <Link
                      href={
                        redirectURL
                          ? `/login?redirectURL=${encodeURIComponent(redirectURL)}`
                          : "/login"
                      }
                      className="ml-[5px] font-medium text-primary hover:underline"
                    >
                      Log in
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
        </div>
      </div>

      {/* Footer */}
      <AuthFooter />
    </div>
  );
};

SignupPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default SignupPage;
