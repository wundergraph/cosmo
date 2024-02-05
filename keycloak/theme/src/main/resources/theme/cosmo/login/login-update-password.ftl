<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<#import "password-commons.ftl" as passwordCommons>
<@layoutCloudIAM.registrationCloudIamLayout displayInfo=true displayMessage=!messagesPerField.existsError('password','password-confirm'); section>
    <#if section = "header">
        ${msg("updatePasswordTitle")}
    <#elseif section = "form">
        <form id="kc-passwd-update-form" action="${url.loginAction}" method="post">
            <input type="hidden" id="username" name="username" value="${username}" autocomplete="username"
                   readonly="readonly"/>
            <input type="password" id="password" name="password" autocomplete="current-password" class="hidden" />

            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelWrapperClass!}">
                    <label for="password-new" class="${properties.kcLabelClass!}">${msg("passwordNew")}</label>
                </div>
                <div class="${properties.kcInputWrapperClass!}">
                    <input type="password" id="password-new" class="${properties.kcInputClass!}" name="password-new"
                           aria-invalid="<#if messagesPerField.existsError('password','password-confirm')>is-invalid</#if>" autofocus autocomplete="new-password"
                    />
                    <#if messagesPerField.existsError('password')>
                        <span id="input-error-password" class="${properties.kcInputErrorMessageClass!}"
                              aria-live="polite">
                            ${kcSanitize(messagesPerField.getFirstError('password'))?no_esc}
                        </span>
                    </#if>
                </div>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelWrapperClass!}">
                    <label for="password-new" class="${properties.kcLabelClass!}">${msg("passwordConfirm")}</label>
                </div>
                <div class="${properties.kcInputWrapperClass!}">
                    <input type="password" id="password-confirm" class="${properties.kcInputClass!}" name="password-confirm"
                           aria-invalid="<#if messagesPerField.existsError('password-confirm')>is-invalid</#if>" autofocus autocomplete="new-password"
                    />
                    <#if messagesPerField.existsError('password-confirm')>
                        <span id="input-error-password-confirm" class="${properties.kcInputErrorMessageClass!}"
                              aria-live="polite">
                            ${kcSanitize(messagesPerField.getFirstError('password-confirm'))?no_esc}
                        </span>
                    </#if>
                </div>
            </div>

            <@passwordCommons.logoutOtherSessions/>

            <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                <input tabindex="4"
                class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400" type="submit" value="${msg("doSubmit")}" id="savePasswordBtn"/>

                <#if isAppInitiatedAction??>
                    <input tabindex="4"
                    class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400" type="submit" value="${msg("doCancel")}" id="cancelTOTPBtn"/>
                </#if>
            </div>

        </form>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>