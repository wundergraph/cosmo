import { ProductCosmoStack } from "@/components/auth/cosmo-stack";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Logo } from "@/components/logo";
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
    <div className="flex min-h-screen items-center justify-center xl:items-start xl:justify-start">
      <div className="relative z-10 m-4 flex w-full max-w-xl flex-col gap-y-4 rounded-lg border bg-gray-950/60 p-4 text-white shadow-xl backdrop-blur-xl md:p-10 lg:m-10 lg:mt-20 xl:mt-52 2xl:mt-60">
        <a href="https://wundergraph.com" className="flex items-center gap-2">
          <Logo width={40} height={40} />
          <h1 className="text-lg font-bold">WunderGraph Cosmo</h1>
        </a>
        <div className="flex flex-col items-start pt-8 md:pt-16">
          <h2 className="mb-1 text-2xl font-medium">Sign up</h2>
          <p className="text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={
                redirectURL ? `/login?redirectURL=${redirectURL}` : "/login"
              }
              className="underline hover:text-foreground"
            >
              Sign in
            </Link>
          </p>

          <div className="mt-12 space-y-4">
            <Button
              variant="outline"
              size="lg"
              className="text-md w-full truncate px-12 py-6"
              asChild
            >
              <Link
                href={constructSignupURL({ redirectURL, provider: "github" })}
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
                href={constructSignupURL({ redirectURL, provider: "google" })}
              >
                <FaGoogle className="me-2" />
                Sign up with Google
              </Link>
            </Button>

            <div className="relative flex items-center py-5" role="separator">
              <div className="flex-grow border-t border-muted"></div>
              <span className="mx-4 flex-shrink text-muted-foreground">or</span>
              <div className="flex-grow border-t border-muted"></div>
            </div>

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
        </div>
      </div>
      <div className="relative hidden flex-1 flex-col items-center gap-y-4 text-center text-white xl:flex xl:pt-40 2xl:pt-52">
        <ProductCosmoStack />
      </div>
    </div>
  );
};

SignupPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default SignupPage;
