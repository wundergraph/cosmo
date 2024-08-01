<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayMessage=false; section>
    <#if section = "header">
        ${msg("termsTitle")}
    <#elseif section = "form">
        <div id="kc-terms-text">
            <p>
                Thank you for your interest in WunderGraph Cosmo! We're happy you're here.<br/><br/>In order to sign up for Cosmo, please read and accept the <a href="https://wundergraph.com/cosmo-managed-service-terms" target="_blank">Cosmo Managed Service Terms of Use.</a>
            </p>
        </div>
        <form class="form-actions" action="${url.loginAction}" method="POST">
            <div id="kc-form-buttons" class="space-y-4">
                <input class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400"
                       name="accept" id="kc-accept" type="submit" value="${msg("doAccept")}"/>
                <input class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-gray-800 transition disabled:cursor-not-allowed text-white bg-gray-800 border-gray-800 hover:bg-gray-700 hover:border-gray-700"
                       name="cancel" id="kc-decline" type="submit" value="${msg("doDecline")}"/>
            </div>
        </form>
        <div class="clearfix"></div>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>
