<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayMessage=false; section>
    <#if section = "header">
        ${msg("termsTitle")}
    <#elseif section = "form">
        <div id="kc-terms-text">
            ${kcSanitize(msg("termsText"))?no_esc}
        </div>
        <form class="form-actions" action="${url.loginAction}" method="POST">
            <div id="kc-form-buttons" class="space-y-4">
                <input class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-sky-900 transition disabled:cursor-not-allowed text-white bg-sky-600 border-sky-500 hover:bg-sky-500 hover:border-sky-400"
                       name="accept" id="kc-accept" type="submit" value="${msg("doAccept")}"/>
                <input class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-gray-800 transition disabled:cursor-not-allowed text-white bg-gray-800 border-gray-800 hover:bg-gray-700 hover:border-gray-700"
                       name="cancel" id="kc-decline" type="submit" value="${msg("doDecline")}"/>
            </div>
        </form>
        <div class="clearfix"></div>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>
