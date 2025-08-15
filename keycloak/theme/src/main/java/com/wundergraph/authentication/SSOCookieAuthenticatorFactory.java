package com.wundergraph.authentication;

import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SSOCookieAuthenticatorFactory implements AuthenticatorFactory {
    public static final String PROVIDER_ID = "sso-cookie-authenticator";
    public static final String SSO_COOKIE_CONFIG_NAME = "sso-cookie-name";
    public static final String DEFAULT_COOKIE_NAME = "cosmo_idp_hint";

    private static final List<ProviderConfigProperty> configProperties;

    static {
        ProviderConfigProperty prop = new ProviderConfigProperty();
        prop.setName(SSO_COOKIE_CONFIG_NAME);
        prop.setLabel("Cookie Name");
        prop.setHelpText("The name of the SSO Cookie");
        prop.setDefaultValue(DEFAULT_COOKIE_NAME);
        prop.setRequired(true);
        prop.setType(ProviderConfigProperty.STRING_TYPE);

        configProperties = List.of(prop);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "SSO Cookie Check";
    }

    @Override
    public Authenticator create(KeycloakSession session) {
        return new SSOCookieAuthenticator();
    }

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public void close() {
    }

    @Override
    public String getReferenceCategory() {
        return "";
    }

    @Override
    public boolean isConfigurable() {
        return true;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return new AuthenticationExecutionModel.Requirement[]{
            AuthenticationExecutionModel.Requirement.REQUIRED,
        };
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return configProperties;
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public String getHelpText() {
        return "Retrieve the SSO cookie and construct an additional SSO login link based on it.";
    }
}
