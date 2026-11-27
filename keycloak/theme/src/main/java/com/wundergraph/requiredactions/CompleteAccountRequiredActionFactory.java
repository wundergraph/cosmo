package com.wundergraph.requiredactions;

import org.keycloak.Config;
import org.keycloak.authentication.RequiredActionFactory;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public class CompleteAccountRequiredActionFactory implements RequiredActionFactory {
    private static final CompleteAccountRequiredAction INSTANCE = new CompleteAccountRequiredAction();

    @Override
    public String getId() {
        return CompleteAccountRequiredAction.PROVIDER_ID;
    }

    @Override
    public String getDisplayText() {
        return "Complete Account";
    }

    @Override
    public RequiredActionProvider create(KeycloakSession session) {
        return INSTANCE;
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
}
