<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout bodyClass="complete-account" displayMessage=false displayInfo=true; section>
    <#if section = "header">
        ${msg("completeAccountTitle")}
    <#elseif section = "form">
        <p class="mb-4 text-sm text-gray-400">${msg("completeAccountSubtitle")}</p>
        <form id="kc-complete-account-form" class="flex flex-col w-full gap-2" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="company_name" class="${properties.kcLabelClass!}">${msg("completeAccountCompanyName")}</label>
                <input type="text" id="company_name" name="company_name" maxlength="255" autocomplete="organization"
                       class="${properties.kcInputClass!}" placeholder="${msg("completeAccountCompanyNamePlaceholder")}"/>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <label for="use_case" class="${properties.kcLabelClass!}">${msg("completeAccountUseCase")}</label>
                <select id="use_case" name="use_case" class="${properties.kcInputClass!}">
                    <option value="" selected>${msg("completeAccountUseCasePlaceholder")}</option>
                    <#list useCaseOptions as option>
                        <option value="${option}">${msg("completeAccountUseCase_" + option)}</option>
                    </#list>
                </select>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <label for="current_setup" class="${properties.kcLabelClass!}">${msg("completeAccountCurrentSetup")}</label>
                <select id="current_setup" name="current_setup" class="${properties.kcInputClass!}">
                    <option value="" selected>${msg("completeAccountCurrentSetupPlaceholder")}</option>
                    <#list currentSetupOptions as option>
                        <option value="${option}">${msg("completeAccountCurrentSetup_" + option)}</option>
                    </#list>
                </select>
            </div>

            <div class="col-span-full space-y-8">
                <div id="kc-form-buttons">
                    <input class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400"
                           type="submit" value="${msg("completeAccountSubmit")}"/>
                </div>
                <div id="kc-form-options">
                    <div class="${properties.kcFormOptionsWrapperClass!}">
                        <span><a href="${url.loginRestartFlowUrl}">${msg("completeAccountBack")}</a></span>
                    </div>
                </div>
            </div>
        </form>
    <#elseif section = "info">
        <p id="kc-complete-account-terms">${kcSanitize(msg("completeAccountTerms"))?no_esc}</p>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>
