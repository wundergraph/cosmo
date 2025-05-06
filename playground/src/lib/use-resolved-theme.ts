import { useEffect, useState } from 'react';

export const useResolvedTheme = (forcedTheme?: string) => {
  const [theme, setTheme] = useState<'light' | 'dark'>();

  useEffect(() => {
    const updateTheme = () => {
      const body = document.body;
      if (body.classList.contains('graphiql-dark')) {
        setTheme('dark');
      } else if (body.classList.contains('graphiql-light')) {
        setTheme('light');
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setTheme(prefersDark ? 'dark' : 'light');
      }

      if (body.classList.contains('graphiql-light')) {
        document.documentElement.classList.remove('!dark');
      } else {
        document.documentElement.classList.add('!dark');
      }
    };

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return forcedTheme || theme;
};
