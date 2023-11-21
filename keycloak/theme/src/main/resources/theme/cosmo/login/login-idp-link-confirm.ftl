<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout; section>
    <#if section = "header">
        ${msg("confirmLinkIdpTitle")}
    <#elseif section = "form">
        <form id="kc-register-form" action="${url.loginAction}" method="post">
            <div id="kc-form-buttons" class="flex flex-col gap-y-4">
                <button type="submit" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400" name="submitAction" id="linkAccount" value="linkAccount">${msg("confirmLinkIdpContinue", idpDisplayName)}</button>
                <button type="submit" class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400" name="submitAction" id="updateProfile" value="updateProfile">${msg("confirmLinkIdpReviewProfile")}
                </button>
            </div>
        </form>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>