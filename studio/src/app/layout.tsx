import { Footer } from "@/components/layout/footer";
import { Metadata } from "next";

import "../styles/globals.css";
import "../styles/login.css";

const getCustomScripts = ():
  | { src: string; id: string; inline?: boolean }[]
  | undefined => {
  try {
    return process.env.CUSTOM_HEAD_SCRIPTS
      ? JSON.parse(process.env.CUSTOM_HEAD_SCRIPTS)
      : [];
  } catch {
    // ignore
  }
};

export const metadata: Metadata = {
  title: "WunderGraph Cosmo Studio",
  description: "WunderGraph Cosmo Studio",
  icons: {
    icon: [
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/favicon/apple-icon-57x57.png", sizes: "57x57" },
      { url: "/favicon/apple-icon-60x60.png", sizes: "60x60" },
      { url: "/favicon/apple-icon-72x72.png", sizes: "72x72" },
      { url: "/favicon/apple-icon-76x76.png", sizes: "76x76" },
      { url: "/favicon/apple-icon-114x114.png", sizes: "114x114" },
      { url: "/favicon/apple-icon-120x120.png", sizes: "120x120" },
      { url: "/favicon/apple-icon-144x144.png", sizes: "144x144" },
      { url: "/favicon/apple-icon-152x152.png", sizes: "152x152" },
      { url: "/favicon/apple-icon-180x180.png", sizes: "180x180" },
    ],
  },
  manifest: "/favicon/manifest.json",
  other: {
    "msapplication-TileColor": "#ffffff",
    "msapplication-TileImage": "/favicon/ms-icon-144x144.png",
    "theme-color": "#ffffff",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const scripts = getCustomScripts();

  return (
    <html
      className="antialiased [font-feature-settings:'ss01']"
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href="/favicon/android-icon-192x192.png"
        />
      </head>
      <body>
        {children}

        <Footer />

        {scripts?.map((script, i) =>
          script.inline ? (
            <script
              key={script.id}
              id={script.id}
              dangerouslySetInnerHTML={{ __html: script.src }}
            />
          ) : (
            <script key={i} id={script.id} src={script.src} async />
          ),
        )}
      </body>
    </html>
  );
}
