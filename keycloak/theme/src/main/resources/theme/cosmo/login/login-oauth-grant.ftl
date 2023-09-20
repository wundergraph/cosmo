<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout bodyClass="oauth"; section>
    <#if section = "header">
        <#if client.attributes.logoUri??>
            <img src="${client.attributes.logoUri}"/>
        </#if>
        <#if client.name?has_content>
            ${msg("oauthGrantTitle",advancedMsg(client.name))}
        <#else>
            ${msg("oauthGrantTitle",client.clientId)}
        </#if>
    <#elseif section = "form">
        <div id="kc-oauth" class="content-area">
            <h1 class="text-lg">${msg("oauthGrantRequest")}</h1>
            <#if client.attributes.policyUri?? || client.attributes.tosUri??>
                <h3>
                    <#if client.name?has_content>
                        ${msg("oauthGrantInformation",advancedMsg(client.name))}
                    <#else>
                        ${msg("oauthGrantInformation",client.clientId)}
                    </#if>
                    <#if client.attributes.tosUri??>
                        ${msg("oauthGrantReview")}
                        <a href="${client.attributes.tosUri}" target="_blank">${msg("oauthGrantTos")}</a>
                    </#if>
                    <#if client.attributes.policyUri??>
                        ${msg("oauthGrantReview")}
                        <a href="${client.attributes.policyUri}" target="_blank">${msg("oauthGrantPolicy")}</a>
                    </#if>
                </h3>
            </#if>

            <form class="form-actions" action="${url.oauthAction}" method="POST">
                <input type="hidden" name="code" value="${oauth.code}">
                <div id="kc-form-buttons" class="flex gap-x-2 my-4">
                    <input tabindex="4" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-sky-900 transition disabled:cursor-not-allowed text-white bg-sky-600 border-sky-500 hover:bg-sky-500 hover:border-sky-400" name="accept" id="kc-login" type="submit" value="${msg("doYes")}"/>
                    <input tabindex="4" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-sky-900 transition disabled:cursor-not-allowed text-white bg-sky-600 border-sky-500 hover:bg-sky-500 hover:border-sky-400" name="cancel" id="kc-cancel" type="submit" value="${msg("doNo")}"/>
                </div>
            </form>
            <div class="clearfix"></div>
        </div>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>