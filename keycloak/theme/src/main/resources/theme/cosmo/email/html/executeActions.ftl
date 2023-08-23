<#outputformat "plainText">
<#assign requiredActionsText><#if requiredActions??><#list requiredActions><#items as reqActionItem>${msg("requiredAction.${reqActionItem}")}<#sep>, </#sep></#items></#list></#if></#assign>
<#assign attributes = user.getAttributes()>
</#outputformat>

<#import "layoutKeycloak.ftl" as layout>
<@layout.layoutKeycloak>
    <div
        id="__react-email-preview"
        style="display: none; overflow: hidden; line-height: 1px; opacity: 0; max-height: 0; max-width: 0"
    >
        Welcome to WunderGraph Cosmo
    </div>
    <body
    style="background-color:#ffffff;margin:0 auto;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif"
  >
    <table
      align="center"
      role="presentation"
      cellspacing="0"
      cellpadding="0"
      border="0"
      width="100%"
      style="
        max-width: 37.5em;
        border: 1px solid #eaeaea;
        border-radius: 5px;
        margin: 40px auto;
        padding: 20px;
        width: 465px;
      "
    >
      <tr style="width: 100%">
        <td>
          <table
            style="margin-top: 32px"
            align="center"
            border="0"
            cellpadding="0"
            cellspacing="0"
            role="presentation"
            width="100%"
          >
            <tbody>
              <tr>
                <td>
                  <img
                    alt="WunderGraph"
                    src="https://wundergraph.com/images/logos/wundergraph-light.png"
                    width="40"
                    height="40"
                    style="display: block; outline: none; border: none; text-decoration: none; margin: 0 auto"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <h1 style="color: #000; font-size: 24px; font-weight: normal; text-align: center; margin: 30px 0; padding: 0">
            <strong>Welcome to WunderGraph Cosmo</strong>
          </h1>
          <p style="font-size: 14px; line-height: 24px; margin: 16px 0; color: #000; text-align: center">
            Hello <strong> ${msg(user.email)}</strong>, you have been invited to an organization on WunderGraph Cosmo.
          </p>
          <p style="font-size: 14px; line-height: 24px; margin: 16px 0; color: #000; text-align: center">
            Please click on the link below to set your password and login.
          </p>
          <table
            style="text-align: center; margin-top: 26px; margin-bottom: 26px"
            align="center"
            border="0"
            cellpadding="0"
            cellspacing="0"
            role="presentation"
            width="100%"
          >
            <tbody>
              <tr>
                <td>
                  <a
                    href="${msg(link)}"
                    target="_blank"
                    style="
                      background-color: #0284c7;
                      border-radius: 5px;
                      color: #fff;
                      font-size: 12px;
                      font-weight: 500;
                      line-height: 100%;
                      text-decoration: none;
                      text-align: center;
                      p-x: 20px;
                      p-y: 12px;
                      display: inline-block;
                      max-width: 100%;
                      padding: 12px 20px;
                    "
                    >
                    <span
                      style="
                        background-color: #0284c7;
                        border-radius: 5px;
                        color: #fff;
                        font-size: 12px;
                        font-weight: 500;
                        line-height: 120%;
                        text-decoration: none;
                        text-align: center;
                        p-x: 20px;
                        p-y: 12px;
                        max-width: 100%;
                        display: inline-block;
                        text-transform: none;
                        mso-padding-alt: 0px;
                        mso-text-raise: 9px;
                      "
                      >Join the organization</span>
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
          <p style="font-size: 14px; line-height: 24px; color: #000">
            Thanks,<br />
            WunderGraph Cosmo
          </p>
          <hr style="border: 1px solid #eaeaea" />
          <p style="font-size: 10px; color: #64748b; text-align: center">
            To reach out for support, contact us at cosmo@wundergraph.com
          </p>
        </td>
      </tr>
    </table>
  </body>
</@layout.layoutKeycloak>