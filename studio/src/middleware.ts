import { NextResponse, NextRequest } from 'next/server';

const TRACKING_KEYS = [
  'utm_campaign',
  'utm_content',
  'utm_id',
  'utm_icid',
  'utm_ICID',
  'utm_medium',
  'utm_source',
  'utm_term',
  'dclid',
  'fbclid',
  'gbraid',
  'gclid',
  'ko_click_id',
  'li_fat_id',
  'msclkid',
  'rtd_cid',
  'ttclid',
  'twclid',
  'wbraid',
];

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.well-known|favicon.ico|favicon/manifest.json|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
};

function setCookie(res: NextResponse, key: string, value: string) {
  let domain: string | undefined = undefined;
  if (process.env.NEXT_PUBLIC_TRACKING_COOKIE_DOMAIN_NAME) {
    domain = process.env.NEXT_PUBLIC_TRACKING_COOKIE_DOMAIN_NAME;
  }

  res.cookies.set(key, value, {
    path: '/',
    domain,
    maxAge: 30 * 24 * 60 * 60, // 1 month
    sameSite: 'lax',
    secure: true,
    httpOnly: false, // Client-side scripts need to be able to read the cookie value
  });
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const searchParams = req.nextUrl.searchParams;
  for (const key of TRACKING_KEYS) {
    let paramValue = searchParams.get(key);
    if (paramValue) {
      setCookie(res, key, paramValue);
    } else if (['utm_medium', 'utm_source'].includes(key)) {
      const existingValue = req.cookies.get(key);
      if (existingValue) {
        // Do not overwrite existing cookies
        continue;
      }

      let forcedValue: string;
      if (key === 'utm_medium') {
        forcedValue = 'website';
      } else {
        forcedValue = 'direct';
      }

      setCookie(res, key, forcedValue);
    }
  }

  return res;
};