import { Suspense } from "react";

import { Metadata } from "next";
import AuthSkeleton from "../_components/skeleton";
import NoScriptWarning from "@/components/noscript-warning";
import AccountLink from "../_components/account-link";
import SignupClient from "./signup-client";

export const metadata: Metadata = {
  title: "Sign Up - WunderGraph Cosmo Studio",
  description: "Create your WunderGraph Cosmo Studio account",
};

export default function SignupPage() {
  return (
    <>
      <AccountLink
        title="Sign up"
        subtitle="Already have an account?"
        href="/login"
        linkText="Sign in"
      />

      <Suspense fallback={<AuthSkeleton />}>
        <SignupClient />
      </Suspense>

      <NoScriptWarning />
    </>
  );
}
