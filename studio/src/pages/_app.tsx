import { AppProvider } from "@/components/app-provider";
import { Layout } from "@/components/layout/layout";
import { MarkdownLayout } from "@/components/layout/markdown-layout";
import { ThemeProvider } from "@/components/theme-provider";
import ErrorFallback from "@/components/error-fallback";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppPropsWithLayout } from "@/lib/page";
import "@graphiql/plugin-explorer/dist/style.css";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import "graphiql/graphiql.css";
import App, { AppContext, AppInitialProps } from "next/app";
import "react-date-range/dist/styles.css"; // main css file
import "react-date-range/dist/theme/default.css"; // theme css file
import "../styles/globals.css";
import "../styles/login.css";
import "../styles/playground.css";
import "../styles/utils.css";
import { useEffect } from "react";
import { Router } from "next/router";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { withErrorBoundary } from "@sentry/nextjs";
import { Footer } from "@/components/layout/footer";

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  useEffect(() => {
    // https://github.com/TanStack/query/pull/4805
    focusManager.setEventListener((handleFocus: any) => {
      window.addEventListener("focus", handleFocus, false);

      return () => {
        window.removeEventListener("focus", handleFocus);
      };
    });
  }, []);

  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: "/ingest",
      loaded: (ph) => {
        if (process.env.NODE_ENV === "development") ph.debug();
      },
      debug: process.env.NODE_ENV === "development",
    });

    const handleRouteChange = () => posthog.capture("$pageview");
    Router.events.on("routeChangeComplete", handleRouteChange);

    return () => {
      Router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, []);

  if (pageProps.markdoc) {
    return (
      <MarkdownLayout>
        <Component {...pageProps} />
      </MarkdownLayout>
    );
  }

  const getLayout = Component.getLayout ?? ((page) => <Layout>{page}</Layout>);

  return (
    <>
      <PostHogProvider client={posthog}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <QueryClientProvider client={queryClient}>
            <AppProvider>
              <TooltipProvider>
                <Toaster />
                {getLayout(<Component {...pageProps} />)}
              </TooltipProvider>
            </AppProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </PostHogProvider>
      <Footer />
    </>
  );
}

// We need to opt out of static site generation because of how we handle runtime envs.
// Or else upon build Next.js generates html with hrefs starting with leading slash and env name.
// We want to avoid that.
MyApp.getInitialProps = async (
  context: AppContext,
): Promise<AppInitialProps> => {
  const ctx = await App.getInitialProps(context);

  return { ...ctx };
};

export default process.env.NEXT_PUBLIC_SENTRY_ENABLED
  ? withErrorBoundary(MyApp, {
      fallback: ErrorFallback,
    })
  : MyApp;
