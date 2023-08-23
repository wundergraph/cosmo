<#import "layoutKeycloak.ftl" as layout>
<@layout.layoutKeycloak>
    <h1>${msg("passwordResetSubject")}</h1>
    ${kcSanitize(msg("passwordResetBodyHtml",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration)))?no_esc}
</@layout.layoutKeycloak>