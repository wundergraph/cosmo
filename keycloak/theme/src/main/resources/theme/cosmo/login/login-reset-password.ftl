<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayInfo=true; section>
    <#if section = "header">
        ${msg("emailForgotTitle")}
    <#elseif section = "form">
    <ul id="nav" class="nav justify-content-center">
      <li class="nav-item">
        <a href="" class="nav-link nuxt-link-active">
          <span>${msg("forgotPassword")}</span>
        </a>
      </li>
    </ul>
    <div class="divider"></div>
    <div class="kcform">
      <h1 id="kc-page-title">
        ${msg("forgotPassword")}
      </h1>
      <form action="${url.loginAction}" method="post">
          <div class="${properties.kcFormGroupClass!}">
              <div class="${properties.kcLabelWrapperClass!}">
                  <label for="username">${msg("email")}</label>
              </div>
              <div class="${properties.kcInputWrapperClass!}">
                  <#if auth?has_content && auth.showUsername()>
                      <input type="email" id="username" name="username" class="${properties.kcInputClass!}" autofocus value="${auth.attemptedUsername}" required/>
                  <#else>
                      <input type="email" id="username" name="username" class="${properties.kcInputClass!}" autofocus required/>
                  </#if>
              </div>
          </div>
          <div class="${properties.kcFormGroupClass!}">
             <div class="${properties.kcInputWrapperClass!}">
                  <div class="form-buttons">
                        <div class="flex-grow-1">
                          <a href="${url.loginUrl}" class="btn btn-outline-primary text-decoration-none" role="button">${kcSanitize(msg("doCancel"))?no_esc}</a>                         
                        </div>
                        <div class="flex">
                           <input class="btn btn-primary" name="login" type="submit" value="${msg("resetPassword")}"/>
                        </div>
                  </div>
              </div>
         </div>
      </form>
   </div>
  </#if>
</@layoutCloudIAM.registrationCloudIamLayout>