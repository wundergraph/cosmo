<#macro layoutKeycloak>
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en">
        <head>
            <title>${properties.kcHtmlTitle!}</title>
             <meta charset="utf-8">
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
            <meta name="robots" content="noindex, nofollow">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <#if properties.stylesCommon?has_content>
                <#list properties.stylesCommon?split(' ') as style>
                    <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet"/>
                </#list>
            </#if>
            <#if properties.styles?has_content>
                <#list properties.styles?split(' ') as style>
                    <link href="${url.resourcesPath}/${style}" rel="stylesheet"/>
                </#list>
            </#if>
        </head>
        <#nested "content">
    </html>
</#macro>

