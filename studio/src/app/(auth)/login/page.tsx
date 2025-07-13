import { Suspense } from "react";

import { Metadata } from "next";
import AuthSkeleton from "../_components/skeleton";
import NoScriptWarning from "@/components/noscript-warning";
import AccountLink from "../_components/account-link";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Login - WunderGraph Cosmo Studio",
  description: "Login to WunderGraph Cosmo Studio",
};

export default function LoginPage() {
  return (
    <>
      <AccountLink
        title="Sign in"
        subtitle="Don't have an account yet?"
        href="/signup"
        linkText="Sign up"
      />

      <Suspense fallback={<AuthSkeleton />}>
        <LoginClient />
      </Suspense>

      <NoScriptWarning />
    </>
  );
}
