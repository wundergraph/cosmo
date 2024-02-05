<#import "layout-cloud-iam.ftl" as layoutCloudIAM>
<@layoutCloudIAM.registrationCloudIamLayout displayInfo=true; section>
    <#if section = "header">
        ${msg("emailVerifyTitle")}
    <#elseif section = "form">
        <p id="instruction1" class="instruction">${msg("emailVerifyInstruction1",user.email)}</p>
        <p id="instruction2" class="instruction">
            <p class="instructionText">${msg("emailVerifyInstruction2")}</p> 
            <p class="instructionText"><a href="${url.loginAction}">${msg("doClickHere")}</a> ${msg("emailVerifyInstruction3")}</p>
        </p>
    </#if>
</@layoutCloudIAM.registrationCloudIamLayout>