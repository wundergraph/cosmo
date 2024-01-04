<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout; section>
    <#if section = "header">
        ${msg("loginChooseAuthenticator")}
    <#elseif section = "form">
        <form id="kc-register-form" action="${url.loginAction}" method="post">
            <div id="kc-form-buttons" class="flex flex-col gap-y-4">
                <#list auth.authenticationSelections as authenticationSelection>
                    <button type="submit" class="flex w-full text-base items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400 py-2 px-4" name="authenticationExecution"
                            value="${authenticationSelection.authExecId}">
                        <div class="flex flex-col gap-y-1 text-left">
                            <h5>${msg('${authenticationSelection.displayName}')}</h5>
                            <small class="text-xs font-normal">${msg('${authenticationSelection.helpText}')}</small>
                        </div>
                    </button>
                </#list>
                <input type="hidden" id="authexec-hidden-input" name="authenticationExecution" />
            </div>
        </form>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>