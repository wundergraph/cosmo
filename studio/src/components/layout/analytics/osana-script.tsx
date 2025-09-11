import Script from "next/script";

export function OsanaScript() {
  const osanaScriptId = process.env.NEXT_PUBLIC_OSANA_SCRIPT_ID;
  if (!osanaScriptId || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return (
    <Script
      id="osano-cmp"
      src={`https://cmp.osano.com/${osanaScriptId}/osano.js`}
      strategy="afterInteractive"
    />
  );
}