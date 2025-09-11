export function OsanaScript() {
  const osanaScriptId = process.env.NEXT_PUBLIC_OSANA_SCRIPT_ID;
  if (!osanaScriptId || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return (
    <script
      id="gtm"
      type="text/javascript"
      async
      defer
      src={`https://cmp.osano.com/${osanaScriptId}/osano.js`}
    />
  );
}