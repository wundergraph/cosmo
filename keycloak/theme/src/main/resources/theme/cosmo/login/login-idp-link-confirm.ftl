<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout; section>
    <#if section = "header">
        ${msg("confirmLinkIdpTitle")}
    <#elseif section = "form">
        <form id="kc-register-form" action="${url.loginAction}" method="post">
            <div id="kc-form-buttons" class="flex flex-col gap-y-4">
                <button type="submit" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-sky-900 transition disabled:cursor-not-allowed text-white bg-sky-600 border-sky-500 hover:bg-sky-500 hover:border-sky-400" name="submitAction" id="linkAccount" value="linkAccount">${msg("confirmLinkIdpContinue", idpDisplayName)}</button>
                <button type="submit" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-sky-900 transition disabled:cursor-not-allowed text-white bg-sky-600 border-sky-500 hover:bg-sky-500 hover:border-sky-400" name="submitAction" id="updateProfile" value="updateProfile">${msg("confirmLinkIdpReviewProfile")}
                </button>
            </div>
        </form>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>