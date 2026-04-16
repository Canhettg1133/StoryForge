import { useEffect, useState } from 'react';

export default function useMobileLayout(breakpoint = 900) {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobileLayout, setIsMobileLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia(query);
    const handleChange = (event) => setIsMobileLayout(event.matches);

    setIsMobileLayout(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [query]);

  return isMobileLayout;
}
