import { AuthLayout } from "@/components/layout/auth-layout";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsBuildingLock } from "react-icons/bs";
import { RiLoginBoxLine } from "react-icons/ri";
import { useCookies } from "react-cookie";
import { useEffect } from "react";

const LoginPage: NextPageWithLayout = () => {
  const router = useRouter();
  const redirectURL = router.query.redirectURL;
  const hint = router.query.hint;
  const [cookies] = useCookies(["ssoSlug"]);

  const constructLoginURL = () => {
    if (redirectURL && hint) {
      return `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login?redirectURL=${redirectURL}&hint=${hint}`;
    } else if (redirectURL) {
      return `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login?redirectURL=${redirectURL}`;
    } else if (hint) {
      return `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login?hint=${hint}`;
    } else {
      return `${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login`;
    }
  };

  useEffect(() => {
    if (!router || hint) return;
    if (cookies && cookies.ssoSlug) {
      router.replace(`/login?hint=${cookies.ssoSlug}`);
    }
  }, [cookies, hint, router]);

  return (
    <div className="-mt-[230px] flex flex-col items-center gap-y-4 text-center text-white">
      <Logo width={100} height={100} />
      <div className="flex flex-col items-center px-4 text-center">
        <h1 className="text-3xl font-bold md:text-6xl">Wundergraph Cosmo</h1>
        <p className="mt-4 text-sm tracking-wide md:text-lg">
          The GraphQL federation platform. One place for all your GraphQL API
          integrations, hosted on-prem or in our cloud.
        </p>
        {hint ? (
          <div className="mt-4 flex gap-x-4 lg:mt-8">
            <Button
              variant="default"
              size="lg"
              className="text-md px-12 py-6"
              asChild
            >
              <Link href={constructLoginURL()} className="flex gap-x-2">
                <BsBuildingLock className="h-5 w-5" />
                Login with SSO
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-6" asChild>
              <Link
                href={`${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login`}
                className="flex gap-x-2"
              >
                <RiLoginBoxLine className="h-5 w-5" />
                Login
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex gap-x-4 lg:mt-8">
            <Button
              variant="default"
              size="lg"
              className="text-md px-12 py-6"
              asChild
            >
              <Link
                href={`${process.env.NEXT_PUBLIC_COSMO_CP_URL}/v1/auth/login`}
                className="flex gap-x-2"
              >
                <RiLoginBoxLine className="h-5 w-5" />
                Login
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-6" asChild>
              <Link href={docsBaseURL} target="blank" rel="noreferrer">
                Documentation
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

LoginPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default LoginPage;
