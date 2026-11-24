import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export type EmbedTheme = 'dark' | 'light';

const embedThemeKey = 'cosmo.embed-theme';

const asEmbedTheme = (value: unknown): EmbedTheme | undefined =>
  value === 'dark' || value === 'light' ? value : undefined;

/**
 * The theme Hub asks a framed page to show with `?theme=`. It is kept for the frame's session, so a framed page keeps
 * Hub's theme after it navigates to a URL without the parameter. Outside Hub's frame there is none.
 */
export const useEmbedTheme = (): EmbedTheme | undefined => {
  const { query } = useRouter();
  const requested = asEmbedTheme(query.theme);
  const isEmbedRequest = query.embed === '1';
  const [theme, setTheme] = useState<EmbedTheme>();

  useEffect(() => {
    if (!isEmbedRequest && window.self === window.top) {
      setTheme(undefined);
      return;
    }

    try {
      if (requested) {
        window.sessionStorage.setItem(embedThemeKey, requested);
      }
      setTheme(requested ?? asEmbedTheme(window.sessionStorage.getItem(embedThemeKey)));
    } catch {
      setTheme(requested);
    }
  }, [requested, isEmbedRequest]);

  return theme;
};
