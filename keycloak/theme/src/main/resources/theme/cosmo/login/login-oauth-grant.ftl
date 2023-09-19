<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout bodyClass="oauth"; section>
    <#if section = "header">
        <#if client.attributes.logoUri??>
            <img src="${client.attributes.logoUri}"/>
        </#if>
    <#elseif section = "form">
        <div id="kc-oauth" class="kcform content-area px-4">
            <h1 id="kc-page-title">
                <#if client.name?has_content>
                    ${msg("oauthGrantTitle",advancedMsg(client.name))}
                <#else>
                    ${msg("oauthGrantTitle",client.clientId)}
                </#if>
            </h1>
            <p>
                <#if client.name?has_content>
                    ${msg("oauthGrantRequest",client.name,(realm.displayName!''))}
                <#else>
                    ${msg("oauthGrantRequest",client.clientId,(realm.displayName!''))}
                </#if>
            </p>
            <ul>
                <#if oauth.clientScopesRequested??>
                    <#list oauth.clientScopesRequested as clientScope>
                        <li>
                            <span><#if !clientScope.dynamicScopeParameter??>
                                        ${advancedMsg(clientScope.consentScreenText)}
                                    <#else>
                                        ${advancedMsg(clientScope.consentScreenText)}: <b>${clientScope.dynamicScopeParameter}</b>
                                </#if>
                            </span>
                        </li>
                    </#list>
                </#if>
            </ul>
            <#if client.attributes.policyUri?? || client.attributes.tosUri??>
                <h3>
                    <#if client.name?has_content>
                        ${msg("oauthGrantInformation",advancedMsg(client.name))}
                    <#else>
                        ${msg("oauthGrantInformation",client.clientId)}
                    </#if>
                    <#if client.attributes.tosUri??>
                        ${msg("oauthGrantReview")}
                        <a href="${client.attributes.tosUri}" target="_blank">${msg("oauthGrantTos")}</a>
                    </#if>
                    <#if client.attributes.policyUri??>
                        ${msg("oauthGrantReview")}
                        <a href="${client.attributes.policyUri}" target="_blank">${msg("oauthGrantPolicy")}</a>
                    </#if>
                </h3>
            </#if>

            <form class="form-actions mt-4" action="${url.oauthAction}" method="POST">
                <input type="hidden" name="code" value="${oauth.code}">
                <div class="${properties.kcFormGroupClass!}">
                    <div id="kc-form-options">
                        <div class="${properties.kcFormOptionsWrapperClass!}">
                        </div>
                    </div>

                    <div id="kc-form-buttons">
                        <div class="form-buttons justify-content-between">
                            <input class="btn btn-outline-primary" name="cancel" id="kc-cancel" type="submit" value="${msg("doCancel")}"/>
                            <input class="btn btn-primary" name="accept" id="kc-login" type="submit" value="${msg("doAllow")}"/>
                        </div>
                    </div>
                </div>
            </form>
            <div class="clearfix"></div>
        </div>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>