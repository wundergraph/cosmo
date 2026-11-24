import { NextPage } from 'next';
import { AppProps } from 'next/app';

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
  // The page reads the session and navigates on its own, so AppProvider's session and organization handling stays out.
  ownsSession?: boolean;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};
