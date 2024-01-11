<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayInfo=true displayMessage=!messagesPerField.existsError('username'); section>
    <#if section = "header">
        ${msg("emailForgotTitle")}
    <#elseif section = "form">
      <div id="kc-form">
        <div id="kc-form-wrapper">
          <form id="kc-reset-password-form" action="${url.loginAction}" method="post">
              <div class="${properties.kcFormGroupClass!}">
                  <div class="${properties.kcLabelWrapperClass!}">
                      <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                  </div>
                  <div class="${properties.kcInputWrapperClass!}">
                      <input type="text" id="username" name="username" class="form-input" autofocus value="${(auth.attemptedUsername!'')}" aria-invalid="<#if messagesPerField.existsError('email')>true</#if>"/>
                      <#if messagesPerField.existsError('email')>
                          <span id="input-error-username" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                      ${kcSanitize(messagesPerField.get('email'))?no_esc}
                          </span>
                      </#if>
                  </div>
              </div>
              <div class="${properties.kcFormGroupClass!} ${properties.kcFormSettingClass!}">
                  <div id="kc-form-options" class="${properties.kcFormOptionsClass!}">
                      <div class="${properties.kcFormOptionsWrapperClass!}">
                          <span><a href="${url.loginUrl}">${kcSanitize(msg("backToLogin"))?no_esc}</a></span>
                      </div>
                  </div>

                  <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                      <input tabindex="4"
                        class="flex h-10 w-full text-base justify-center items-center space-x-3 rounded-md border font-semibold focus:outline-none focus:ring-2 focus:ring-pink-900 transition disabled:cursor-not-allowed text-white bg-pink-600 border-pink-500 hover:bg-pink-500 hover:border-pink-400" type="submit" value="${msg("doSubmit")}"/>
                  </div>
              </div>
          </form>
        </div>
      </div>
    <#elseif section = "info" >
        <#if realm.duplicateEmailsAllowed>
            ${msg("emailInstructionUsername")}
        <#else>
            ${msg("emailInstruction")}
        </#if>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>