(function () {
    const AC_ACCOUNT = '1001761818';
    const AC_SRC = 'https://diffuser-cdn.app-us1.com/diffuser/diffuser.js';
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
        })(window,document,AC_SRC,"vgo");

        vgo('setAccount', AC_ACCOUNT);
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