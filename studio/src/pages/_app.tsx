import { AppProvider } from "@/components/app-provider";
import { Layout } from "@/components/layout/layout";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { AppPropsWithLayout } from "@/lib/page";
import "@graphiql/plugin-explorer/dist/style.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "graphiql/graphiql.css";
import App, { AppContext, AppInitialProps } from "next/app";
import "react-date-range/dist/styles.css"; // main css file
import "react-date-range/dist/theme/default.css"; // theme css file
import "../styles/explorer.css";
import "../styles/globals.css";
import "../styles/login.css";
import "../styles/utils.css";

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout = Component.getLayout ?? ((page) => <Layout>{page}</Layout>);
  return (
    <>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryClientProvider client={queryClient}>
          <AppProvider>
            <Toaster />
            {getLayout(<Component {...pageProps} />)}
          </AppProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </>
  );
}

// We need to opt out of static site generation because of how we handle runtime envs.
// Or else upon build Next.js generates html with hrefs starting with leading slash and env name.
// We want to avoid that.
MyApp.getInitialProps = async (
  context: AppContext
): Promise<AppInitialProps> => {
  const ctx = await App.getInitialProps(context);

  return { ...ctx };
};

export default MyApp;
