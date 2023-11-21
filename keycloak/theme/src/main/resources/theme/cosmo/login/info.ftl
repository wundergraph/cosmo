<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayMessage=false; section>
    <#if section = "header">
        <#if messageHeader??>
        ${messageHeader}
        <#else>
        ${message.summary}
        </#if>
    <#elseif section = "form">
    <div id="kc-info-message">
        <p class="text-sm">${message.summary}<#if requiredActions??><#list requiredActions>: <b><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>, </#items></b></#list><#else></#if></p>
        <#if skipLink??>
        <#else>
            <#if pageRedirectUri?has_content>
                <a href="${pageRedirectUri}"
                    class="mt-4 flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400 hover:no-underline hover:text-white"
                    role="button">&laquo; Back to Application</a>
            <#elseif actionUri?has_content>
                <a href="${actionUri}"
                    class="mt-4 flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400 hover:no-underline hover:text-white"
                    role="button">${kcSanitize(msg("proceedWithAction"))?no_esc}</a>
            <#else>
                <a href="${properties.logoUrl}"
                    class="mt-4 flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400 hover:no-underline hover:text-white"
                    role="button">${msg("backToApplication")}</a>
            </#if>
        </#if>
    </div>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>