import { ProductCosmoStack } from "@/components/auth/cosmo-stack";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { NextPageWithLayout } from "@/lib/page";
import { ArrowRightIcon, GitHubLogoIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { FaGoogle } from "react-icons/fa";

const loginUrl = `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/signup`;

const LoginPage: NextPageWithLayout = () => {
  const router = useRouter();
  const redirectURL = router.query.redirectURL;

  const urlAffix = redirectURL ? `redirectURL=${redirectURL}` : "";

  return (
    <div className="flex h-screen items-start justify-center overflow-hidden xl:justify-start">
      <div className="relative z-10 m-4 mt-20 flex max-w-xl flex-col gap-y-4 rounded-lg border bg-gray-950/60 p-10 text-center text-white shadow-xl backdrop-blur-xl lg:m-10 xl:mt-60">
        <div className="flex items-center gap-2">
          <Logo width={40} height={40} />
          <h1 className="text-lg font-bold">Wundergraph Cosmo</h1>
        </div>
        <div className="flex flex-col items-start pt-16">
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
              className="text-md w-full px-12 py-6"
              asChild
            >
              <Link href={loginUrl + `?provider=github&${urlAffix}`}>
                <GitHubLogoIcon className="me-2" />
                Sign up with GitHub
              </Link>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="text-md w-full px-12 py-6"
              asChild
            >
              <Link href={loginUrl + `?provider=google&${urlAffix}`}>
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
              className="text-md group w-full px-12 py-6"
              asChild
            >
              <Link href={loginUrl + `?${urlAffix}`}>
                Continue with Email{" "}
                <ArrowRightIcon className="ms-2 transition-all group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <div className="relative hidden flex-1 flex-col items-center gap-y-4 pt-52 text-center text-white xl:flex">
        <ProductCosmoStack />
      </div>
    </div>
  );
};

LoginPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default LoginPage;
