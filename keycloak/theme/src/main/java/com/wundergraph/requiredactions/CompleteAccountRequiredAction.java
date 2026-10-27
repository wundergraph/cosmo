package com.wundergraph.requiredactions;

import jakarta.ws.rs.core.MultivaluedMap;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.common.util.Time;
import org.keycloak.models.UserModel;

import java.util.List;

/**
 * Replaces the built-in TERMS_AND_CONDITIONS action. Collects optional segmentation details, which the control plane
 * forwards on the user registered webhook, and records the terms acceptance in the same attribute the built-in action
 * uses.
 */
public class CompleteAccountRequiredAction implements RequiredActionProvider {
    public static final String PROVIDER_ID = "COMPLETE_ACCOUNT";

    private static final String TERMS_ATTRIBUTE = "terms_and_conditions";
    private static final String COMPANY_NAME_ATTRIBUTE = "company_name";
    private static final String USE_CASE_ATTRIBUTE = "use_case";
    private static final String CURRENT_SETUP_ATTRIBUTE = "current_setup";
    private static final int COMPANY_NAME_MAX_LENGTH = 255;

    // The keys are forwarded on the webhook, so they must stay stable. Labels live in the theme messages.
    private static final List<String> USE_CASES = List.of(
        "migrating_from_apollo",
        "migrating_from_appsync",
        "governing_ai_agents",
        "first_federation",
        "replacing_federation_gateway",
        "evaluating_new_project",
        "exploring",
        "other"
    );

    private static final List<String> CURRENT_SETUPS = List.of(
        "monolith_to_federation",
        "rest_to_graphql",
        "post_ma_consolidation",
        "federated_scaling_governance",
        "not_sure",
        "other"
    );

    @Override
    public void evaluateTriggers(RequiredActionContext context) {
        // Added to new users as a default action; nothing to evaluate
    }

    @Override
    public void requiredActionChallenge(RequiredActionContext context) {
        context.challenge(
            context.form()
                .setAttribute("useCaseOptions", USE_CASES)
                .setAttribute("currentSetupOptions", CURRENT_SETUPS)
                .createForm("complete-account.ftl")
        );
    }

    @Override
    public void processAction(RequiredActionContext context) {
        MultivaluedMap<String, String> form = context.getHttpRequest().getDecodedFormParameters();
        UserModel user = context.getUser();

        String companyName = form.getFirst(COMPANY_NAME_ATTRIBUTE);
        if (companyName != null && !companyName.isBlank()) {
            String trimmed = companyName.strip();
            user.setSingleAttribute(
                COMPANY_NAME_ATTRIBUTE,
                trimmed.length() > COMPANY_NAME_MAX_LENGTH ? trimmed.substring(0, COMPANY_NAME_MAX_LENGTH) : trimmed
            );
        }

        // Only accept known options so the webhook never carries arbitrary values
        String useCase = form.getFirst(USE_CASE_ATTRIBUTE);
        if (useCase != null && USE_CASES.contains(useCase)) {
            user.setSingleAttribute(USE_CASE_ATTRIBUTE, useCase);
        }

        String currentSetup = form.getFirst(CURRENT_SETUP_ATTRIBUTE);
        if (currentSetup != null && CURRENT_SETUPS.contains(currentSetup)) {
            user.setSingleAttribute(CURRENT_SETUP_ATTRIBUTE, currentSetup);
        }

        // Submitting the form is accepting the terms
        user.setSingleAttribute(TERMS_ATTRIBUTE, Integer.toString(Time.currentTime()));

        context.success();
    }

    @Override
    public void close() {
    }
}
