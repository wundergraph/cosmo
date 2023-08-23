<#import "layoutKeycloak.ftl" as layout>
<@layout.layoutKeycloak>
    <h1>${msg("emailVerificationSubject")}</h1>
    ${kcSanitize(msg("emailVerificationBodyHtml",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration)))?no_esc}
</@layout.layoutKeycloak>
