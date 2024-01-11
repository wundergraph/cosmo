<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout; section>
    <#if section = "header">
        ${msg("emailLinkIdpTitle", idpDisplayName)}
    <#elseif section = "form">
        <p id="instruction1" class="instruction">
            ${msg("emailLinkIdp1", idpDisplayName, brokerContext.username, realm.displayName)}
        </p>
        <p id="instruction2" class="instruction">
            <p class="instructionText">${msg("emailLinkIdp2")}</p> 
            <p class="instructionText"><a href="${url.loginAction}">${msg("doClickHere")}</a> ${msg("emailLinkIdp3")}</p>
        </p>
        <p id="instruction3" class="instruction">
            <p class="instructionText">${msg("emailLinkIdp4")}</p> 
            <p class="instructionText"><a href="${url.loginAction}">${msg("doClickHere")}</a> ${msg("emailLinkIdp5")}</p>
        </p>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>