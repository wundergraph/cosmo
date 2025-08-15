package com.wundergraph.authentication;

import jakarta.ws.rs.core.*;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.*;
import org.keycloak.protocol.LoginProtocol;
import org.keycloak.sessions.AuthenticationSessionModel;

import java.util.Map;

public class SSOCookieAuthenticator implements Authenticator {
    @Override
    public void authenticate(AuthenticationFlowContext authenticationFlowContext) {
        String ssoCookieName = getSSOCookieName(authenticationFlowContext);

        // Retrieve the configured SSO cookie name
        Map<String, Cookie> cookies = authenticationFlowContext.getHttpRequest().getHttpHeaders().getCookies();
        Cookie ssoCookie = cookies.getOrDefault(ssoCookieName, null);
        if (ssoCookie == null) {
            // The SSO cookie was not found
            authenticationFlowContext.success();
            return;
        }

        // Ensure that the SSO cookie value is not empty and set the hint note
        String ssoCookieValue = ssoCookie.getValue();
        if (ssoCookieValue == null || ssoCookieValue.trim().isEmpty()) {
            // The SSO cookie doesn't exist or the value is empty
            authenticationFlowContext.success();
            return;
        }

        ssoCookieValue = ssoCookieValue.trim();

        // Make sure that value of the SSO cookie is a registered and enabled IDP
        KeycloakSession session = authenticationFlowContext.getSession();
        RealmModel realm = authenticationFlowContext.getRealm();

        IdentityProviderStorageProvider storage = session.getProvider(IdentityProviderStorageProvider.class);
        IdentityProviderModel idpModel = storage.getByAlias(ssoCookieValue);

        if (idpModel != null && idpModel.isEnabled()) {
            // Create the login URL for it and pass it to the frontend
            String ssoLoginUrl = composeLoginUrl(realm, idpModel, authenticationFlowContext);
            authenticationFlowContext.form().setAttribute("ssoLoginUrl", ssoLoginUrl);
        }

        authenticationFlowContext.success();
    }

    @Override
    public void action(AuthenticationFlowContext authenticationFlowContext) {
        // No-op
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession keycloakSession, RealmModel realmModel, UserModel userModel) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession keycloakSession, RealmModel realmModel, UserModel userModel) {
        // No-op
    }

    @Override
    public void close() {
        // No-op
    }

    private static String getSSOCookieName(AuthenticationFlowContext authenticationFlowContext) {
        AuthenticatorConfigModel config = authenticationFlowContext.getAuthenticatorConfig();
        if (config == null) {
            return SSOCookieAuthenticatorFactory.DEFAULT_COOKIE_NAME;
        }

        // Retrieve the SSO cookie name configuration
        String ssoCookieName = config.getConfig().getOrDefault(
            SSOCookieAuthenticatorFactory.SSO_COOKIE_CONFIG_NAME,
            SSOCookieAuthenticatorFactory.DEFAULT_COOKIE_NAME
        );

        if (ssoCookieName == null || ssoCookieName.isEmpty()) {
            // The cookie name has not been configured
            return SSOCookieAuthenticatorFactory.DEFAULT_COOKIE_NAME;
        }

        return ssoCookieName.trim();
    }

    private static String composeLoginUrl(
        RealmModel realm,
        IdentityProviderModel idpModel,
        AuthenticationFlowContext authenticationFlowContext)
    {
        KeycloakSession session = authenticationFlowContext.getSession();
        AuthenticationSessionModel authSession = authenticationFlowContext.getAuthenticationSession();
        UriInfo uriInfo = authenticationFlowContext.getUriInfo();

        // Adapted from
        // https://github.com/keycloak/keycloak/blob/10947d002fa9c70c26e7b5a266f71f83d5c2688b/services/src/main/java/org/keycloak/authentication/AuthenticationProcessor.java#L308
        LoginProtocol protocol = session.getProvider(LoginProtocol.class, authSession.getProtocol());
        String clientData = protocol.getClientData(authSession).encode();

        // Build the URL
        UriBuilder uriBuilder = uriInfo.getBaseUriBuilder()
            .path("realms")
            .path(realm.getName())
            .path("broker")
            .path(idpModel.getAlias())
            .path("login");

        uriBuilder.queryParam(Constants.CLIENT_ID, authSession.getClient().getClientId());
        uriBuilder.queryParam(Constants.TAB_ID, authSession.getTabId());
        uriBuilder.queryParam(Constants.CLIENT_DATA, clientData);
        uriBuilder.queryParam("session_code", authenticationFlowContext.generateAccessCode());

        String loginHint = authSession.getClientNote("login_hint");
        if (loginHint != null && !loginHint.isEmpty()) {
            uriBuilder.queryParam("login_hint", loginHint);
        }

        return uriBuilder.build().toString();
    }
}
