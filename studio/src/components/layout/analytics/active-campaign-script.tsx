import Script from "next/script";

const ACTIVE_CAMPAIGN_SCRIPT_SRC = 'https://diffuser-cdn.app-us1.com/diffuser/diffuser.js';

export function ActiveCampaignScript() {
  const acAccount = process.env.NEXT_PUBLIC_ACTIVE_CAMPAIGN_ACCOUNT;
  if (!acAccount || process.env.NODE_ENV !== 'production') {
    return null;
  }

  return (
    <Script id="active-campaign" strategy="afterInteractive">{`
(function () {
  let loaded = false;
  function loadActiveCampaign() {
    if (loaded) {
      return;
    }
    
    loaded = true;
    (function(e,t,o,n,p,r,i){
      e.visitorGlobalObjectAlias=n;
      e[e.visitorGlobalObjectAlias]=e[e.visitorGlobalObjectAlias]||function(){
        (e[e.visitorGlobalObjectAlias].q=e[e.visitorGlobalObjectAlias].q||[]).push(arguments)
      };
      e[e.visitorGlobalObjectAlias].l=(new Date).getTime();
      r=t.createElement("script"); r.src=o; r.async=true;
      i=t.getElementsByTagName("script")[0]; i.parentNode.insertBefore(r,i);
    })(window,document,${JSON.stringify(ACTIVE_CAMPAIGN_SCRIPT_SRC)},"vgo");
    
    vgo('setAccount', ${JSON.stringify(acAccount)});
    vgo('setTrackByDefault', false);
    vgo('process', 'allowTracking');
  }
  
  function updateConsentFromOsano() {
    const consent = window.Osano && Osano.cm && Osano.cm.getConsent ? Osano.cm.getConsent() : null;
    const marketing = (consent && consent.MARKETING === 'ACCEPT' || !!(window.Osano && Osano.cm && Osano.cm.marketing));
    const analytics = (consent && consent.ANALYTICS === 'ACCEPT' || !!(window.Osano && Osano.cm && Osano.cm.analytics));
    
    if (marketing || analytics) {
      loadActiveCampaign();
    }
  }
  
  function onOsanoReady() {
    updateConsentFromOsano();
    Osano.cm.addEventListener('osano-cm-marketing', loadActiveCampaign);
    Osano.cm.addEventListener('osano-cm-analytics', loadActiveCampaign);
    Osano.cm.addEventListener('osano-cm-consent-changed', updateConsentFromOsano);
  }
  if (window.Osano && Osano.cm) {
    onOsanoReady();
  } else {
    window.addEventListener('osano-cm-initialized', onOsanoReady, { once: true });
  }
})();
`}</Script>
  );
}