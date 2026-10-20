export const COSMO_AI_TERMS_OF_SERVICE_REVISION_DATE = new Date('2026/09/01');

export const COSMO_AI_TERMS_OF_SERVICE_MARKDOWN = `# Cosmo AI Beta Terms

**Last updated: September 1, 2026**

These Cosmo AI Beta Terms (the **“Beta Terms”**) govern Customer’s access to and use of Cosmo AI, a set of optional artificial intelligence beta features (**"Cosmo AI"**) provided by WunderGraph, Inc. (**“WunderGraph”**). The person accepting these Beta Terms represents that they are authorized to accept them and enable Cosmo AI features on behalf of the organization they represent (**“Customer”**).

## 1. Beta Feature

**Cosmo AI is experimental.** Its features, functionality, models, providers, and availability may change during the beta. WunderGraph may limit, suspend, or discontinue the beta or parts of it at any time. No service level, availability, or support commitment applies to Cosmo AI unless WunderGraph expressly agrees otherwise in writing.

Cosmo AI's "Prompt to Query" feature converts natural-language prompts into GraphQL queries using relevant schema information available to the service. The generated query is provided to Customer who may submit it to Customer’s Cosmo Router for execution. WunderGraph does not independently review or approve a generated query before execution, and Cosmo AI does not receive Cosmo Router’s execution response.

## 2. Customer Content and Responsibilities

**“Prompt Content”** means natural-language content Customer or its users submit to Cosmo AI. Customer is responsible for Prompt Content and for ensuring that it has all rights, permissions, notices, consents, and other legal bases necessary for WunderGraph and its providers to process Prompt Content as described in these Beta Terms.

Customer must not submit passwords, authentication credentials, payment-card or bank-account information, government-issued identification numbers, protected health information, special-category or other highly sensitive or regulated personal information, or other information that Customer is not authorized to disclose or process through Cosmo AI.

Customer is responsible for informing its users about its use of Cosmo AI and third-party AI services where required by applicable law. If Customer’s agreement with WunderGraph, its own policies, or applicable law does not permit the processing described in these Beta Terms, Customer must not enable or use Cosmo AI.

## 3. AI Processing and Third-Party Providers

To provide Cosmo AI, WunderGraph may transmit Prompt Content, relevant schema information, and WunderGraph instructions to Vercel AI Gateway and / or to third-party AI model providers selected by WunderGraph. Customer authorizes this processing and understands that the model providers used by Cosmo AI may change from time to time and that processing may occur in the United States or other locations where those providers operate.

WunderGraph configures the third-party inference services used for Cosmo AI to operate under zero-data-retention and no-training controls for Prompt Content and model output.

## 4. Beta Logging and Product Improvement

During the beta, WunderGraph may retain Prompt Content, relevant schema information included in the interaction, generated GraphQL queries, intermediate AI outputs or actions, error information, and associated Cosmo AI interaction records (collectively, **“Beta Data”**). Beta Data will be deleted no later than **twelve (12) months from collection**, except where longer retention is required by law or permitted by Customer.

Customer instructs and authorizes WunderGraph to use Beta Data to provide, operate, troubleshoot, debug, evaluate, test, secure, develop, and improve Cosmo AI and related AI functionality. Improvements derived from Beta Data may benefit other WunderGraph customers, but WunderGraph will not disclose Customer’s Prompt Content and responses to other customers or use Customer’s Prompt Content to respond to another customer’s request.

Access to Beta Data is limited to authorized WunderGraph employees and contractors working on Cosmo AI and subject to appropriate confidentiality obligations. Customer may request earlier deletion of its Beta Data through WunderGraph support, subject to reasonable technical deletion cycles and any retention required by law.

WunderGraph may retain aggregated or deidentified information derived from Beta Data after the applicable retention period where that information can no longer reasonably be linked to Customer, a user, or an identifiable individual, and WunderGraph will not attempt to reidentify such information.

## 5. Generated Queries and Customer Use

Cosmo AI uses probabilistic AI systems. Generated queries and information may be inaccurate, incomplete, invalid, non-unique, or inconsistent with Customer’s intent. Customer understands and accepts the risks of submitting generated queries to Cosmo Router.

Customer remains responsible for its Router configuration, permissions, and access controls and for determining whether results obtained through Cosmo AI are appropriate for Customer’s purposes. WunderGraph does not warrant that generated queries will be error-free, suitable for a particular purpose, or free from third-party intellectual-property claims.

## 6. Beta Disclaimer

TO THE MAXIMUM EXTENT PERMITTED BY LAW, COSMO AI IS PROVIDED **“AS IS”** AND **“AS AVAILABLE.”** WUNDERGRAPH DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, RELIABILITY, AND NON-INFRINGEMENT.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, WUNDERGRAPH WILL NOT BE RESPONSIBLE FOR CUSTOMER’S RELIANCE ON A GENERATED QUERY, FOR ACTIONS OR RESULTS ARISING FROM EXECUTION OF A GENERATED QUERY, OR FOR CUSTOMER’S SUBMISSION OF DATA IN VIOLATION OF THESE BETA TERMS.

## 7. Liability

Any exclusions or limitations of liability in a written agreement governing Customer’s use of WunderGraph services remain in effect and apply to Cosmo AI to the extent applicable.

If no such limitation applies to a claim arising from Cosmo AI, then, to the maximum extent permitted by law, WunderGraph’s aggregate liability arising out of or relating to Cosmo AI or these Beta Terms will not exceed **US$100**, and WunderGraph will not be liable for any indirect, incidental, special, exemplary, consequential, or punitive damages, or for lost profits, revenues, data, or business opportunities. Nothing in these Beta Terms excludes or limits liability that cannot lawfully be excluded or limited.

## 8. General

These Beta Terms are additional terms governing the optional Cosmo AI beta and supplement any agreement governing Customer’s use of WunderGraph services. They do not override conflicting terms of a separately signed agreement except to the extent that agreement permits feature-specific online terms to do so.

WunderGraph may update these Beta Terms during the beta. If WunderGraph makes a material change to the processing of Customer data or to Customer’s material obligations under these Beta Terms, WunderGraph will require Customer to accept the updated Beta Terms before continued use of Cosmo AI.

Customer may provide feedback about Cosmo AI. WunderGraph may use such feedback without restriction or obligation, provided that this does not expand WunderGraph’s rights to Prompt Content beyond these Beta Terms.

The governing-law and dispute-resolution provisions of Customer’s applicable agreement with WunderGraph apply to these Beta Terms. If no such provisions apply, these Beta Terms are governed by Delaware law, without regard to conflict-of-law principles, and the state and federal courts located in Delaware will have exclusive jurisdiction.
`;
