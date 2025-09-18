import Script from "next/script";

export function GtmScript() {
  const gtmId = process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID;

  return (
    <>
      <Script id="gtm" strategy="afterInteractive">{`
        (function(w,d,s,l,i){
          w[l]=w[l]||[];
          w[l].push({'gtm.start': new Date().getTime(), event:'gtm.js'});
          var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s), dl=l!='dataLayer'?'&l='+l:'';
          j.async=true; j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
          f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer',${JSON.stringify(gtmId)});
      `}</Script>

      <Script id="gtm-consent" strategy="afterInteractive">{`
(function(){
  function updateConsentFromOsano() {
    const consent = window.Osano && Osano.cm && Osano.cm.getConsent ? Osano.cm.getConsent() : null;
    const marketing = (consent && consent.MARKETING === 'ACCEPT' || !!(window.Osano && Osano.cm && Osano.cm.marketing));
    const analytics = (consent && consent.ANALYTICS === 'ACCEPT' || !!(window.Osano && Osano.cm && Osano.cm.analytics));
    
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        ad_storage: marketing ? 'granted' : 'denied',
        ad_user_data: marketing ? 'granted' : 'denied',
        ad_personalization: marketing ? 'granted' : 'denied',
        analytics_storage: analytics ? 'granted' : 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted'
      });
    }
  }
  
  function onOsanoReady() {
    updateConsentFromOsano();
    Osano.cm.addEventListener('osano-cm-consent-changed', updateConsentFromOsano);
  }
  if (window.Osano && Osano.cm) {
    onOsanoReady();
  } else {
    window.addEventListener('osano-cm-initialized', onOsanoReady, { once: true });
  }
})();
      `}</Script>
    </>
  );
}

export function GtmNoScript() {
  const gtmId = process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID;
  if (!gtmId || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  );
}