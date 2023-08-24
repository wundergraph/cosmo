// https://protobuf.dev/programming-guides/style/

// @generated by protoc-gen-connect-query v0.4.1 with parameter "target=ts"
// @generated from file wg/cosmo/platform/v1/platform.proto (package wg.cosmo.platform.v1, syntax proto3)
/* eslint-disable */
// @ts-nocheck

import { createQueryService } from "@bufbuild/connect-query";
import { MethodIdempotency, MethodKind } from "@bufbuild/protobuf";
import { CheckFederatedGraphRequest, CheckFederatedGraphResponse, CheckSubgraphSchemaRequest, CheckSubgraphSchemaResponse, CreateAPIKeyRequest, CreateAPIKeyResponse, CreateFederatedGraphRequest, CreateFederatedGraphResponse, CreateFederatedGraphTokenRequest, CreateFederatedGraphTokenResponse, CreateFederatedSubgraphRequest, CreateFederatedSubgraphResponse, DeleteAPIKeyRequest, DeleteAPIKeyResponse, DeleteFederatedGraphRequest, DeleteFederatedGraphResponse, DeleteFederatedSubgraphRequest, DeleteFederatedSubgraphResponse, FixSubgraphSchemaRequest, FixSubgraphSchemaResponse, GetAnalyticsViewRequest, GetAnalyticsViewResponse, GetAPIKeysRequest, GetAPIKeysResponse, GetCheckDetailsRequest, GetCheckDetailsResponse, GetChecksByFederatedGraphNameRequest, GetChecksByFederatedGraphNameResponse, GetDashboardAnalyticsViewRequest, GetDashboardAnalyticsViewResponse, GetFederatedGraphByNameRequest, GetFederatedGraphByNameResponse, GetFederatedGraphChangelogRequest, GetFederatedGraphChangelogResponse, GetFederatedGraphSDLByNameRequest, GetFederatedGraphSDLByNameResponse, GetFederatedGraphsRequest, GetFederatedGraphsResponse, GetFederatedSubgraphSDLByNameRequest, GetFederatedSubgraphSDLByNameResponse, GetOrganizationMembersRequest, GetOrganizationMembersResponse, GetSubgraphByNameRequest, GetSubgraphByNameResponse, GetSubgraphsRequest, GetSubgraphsResponse, GetTraceRequest, GetTraceResponse, InviteUserRequest, InviteUserResponse, PublishFederatedSubgraphRequest, PublishFederatedSubgraphResponse, RemoveInvitationRequest, RemoveInvitationResponse, UpdateFederatedGraphRequest, UpdateFederatedGraphResponse, UpdateSubgraphRequest, UpdateSubgraphResponse } from "./platform_pb.js";
import { GetConfigRequest, GetConfigResponse } from "../../node/v1/node_pb.js";

export const typeName = "wg.cosmo.platform.v1.PlatformService";

/**
 * CreateFederatedGraph creates a federated graph on the control plane.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CreateFederatedGraph
 */
export const createFederatedGraph = createQueryService({
  service: {
    methods: {
      createFederatedGraph: {
        name: "CreateFederatedGraph",
        kind: MethodKind.Unary,
        I: CreateFederatedGraphRequest,
        O: CreateFederatedGraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).createFederatedGraph;

/**
 * CreateFederatedSubgraph creates a federated subgraph on the control plane.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CreateFederatedSubgraph
 */
export const createFederatedSubgraph = createQueryService({
  service: {
    methods: {
      createFederatedSubgraph: {
        name: "CreateFederatedSubgraph",
        kind: MethodKind.Unary,
        I: CreateFederatedSubgraphRequest,
        O: CreateFederatedSubgraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).createFederatedSubgraph;

/**
 * PublishFederatedSubgraph pushes the schema of the subgraph to the control plane.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.PublishFederatedSubgraph
 */
export const publishFederatedSubgraph = createQueryService({
  service: {
    methods: {
      publishFederatedSubgraph: {
        name: "PublishFederatedSubgraph",
        kind: MethodKind.Unary,
        I: PublishFederatedSubgraphRequest,
        O: PublishFederatedSubgraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).publishFederatedSubgraph;

/**
 * DeleteFederatedGraph deletes a federated graph from the control plane.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.DeleteFederatedGraph
 */
export const deleteFederatedGraph = createQueryService({
  service: {
    methods: {
      deleteFederatedGraph: {
        name: "DeleteFederatedGraph",
        kind: MethodKind.Unary,
        I: DeleteFederatedGraphRequest,
        O: DeleteFederatedGraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).deleteFederatedGraph;

/**
 * DeleteFederatedSubgraph deletes a federated subgraph from the control plane.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.DeleteFederatedSubgraph
 */
export const deleteFederatedSubgraph = createQueryService({
  service: {
    methods: {
      deleteFederatedSubgraph: {
        name: "DeleteFederatedSubgraph",
        kind: MethodKind.Unary,
        I: DeleteFederatedSubgraphRequest,
        O: DeleteFederatedSubgraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).deleteFederatedSubgraph;

/**
 * CheckSubgraphSchema checks if the schema is valid and if it can be composed without conflicts with the provided new subgraph schema.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CheckSubgraphSchema
 */
export const checkSubgraphSchema = createQueryService({
  service: {
    methods: {
      checkSubgraphSchema: {
        name: "CheckSubgraphSchema",
        kind: MethodKind.Unary,
        I: CheckSubgraphSchemaRequest,
        O: CheckSubgraphSchemaResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).checkSubgraphSchema;

/**
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.FixSubgraphSchema
 */
export const fixSubgraphSchema = createQueryService({
  service: {
    methods: {
      fixSubgraphSchema: {
        name: "FixSubgraphSchema",
        kind: MethodKind.Unary,
        I: FixSubgraphSchemaRequest,
        O: FixSubgraphSchemaResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).fixSubgraphSchema;

/**
 * UpdateFederatedGraph updates a federated graph with new labels and routing url
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.UpdateFederatedGraph
 */
export const updateFederatedGraph = createQueryService({
  service: {
    methods: {
      updateFederatedGraph: {
        name: "UpdateFederatedGraph",
        kind: MethodKind.Unary,
        I: UpdateFederatedGraphRequest,
        O: UpdateFederatedGraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).updateFederatedGraph;

/**
 * UpdateSubgraph updates a subgraph with new labels and routing url
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.UpdateSubgraph
 */
export const updateSubgraph = createQueryService({
  service: {
    methods: {
      updateSubgraph: {
        name: "UpdateSubgraph",
        kind: MethodKind.Unary,
        I: UpdateSubgraphRequest,
        O: UpdateSubgraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).updateSubgraph;

/**
 * CheckFederatedGraph checks if the federated graph can be composed with the new labels provided.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CheckFederatedGraph
 */
export const checkFederatedGraph = createQueryService({
  service: {
    methods: {
      checkFederatedGraph: {
        name: "CheckFederatedGraph",
        kind: MethodKind.Unary,
        I: CheckFederatedGraphRequest,
        O: CheckFederatedGraphResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).checkFederatedGraph;

/**
 * GetFederatedGraphs returns the list of federated graphs.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetFederatedGraphs
 */
export const getFederatedGraphs = createQueryService({
  service: {
    methods: {
      getFederatedGraphs: {
        name: "GetFederatedGraphs",
        kind: MethodKind.Unary,
        I: GetFederatedGraphsRequest,
        O: GetFederatedGraphsResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getFederatedGraphs;

/**
 * GetFederatedGraphByName returns the federated graph by name.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetFederatedGraphByName
 */
export const getFederatedGraphByName = createQueryService({
  service: {
    methods: {
      getFederatedGraphByName: {
        name: "GetFederatedGraphByName",
        kind: MethodKind.Unary,
        I: GetFederatedGraphByNameRequest,
        O: GetFederatedGraphByNameResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getFederatedGraphByName;

/**
 * GetFederatedGraphSDLByName returns the SDL of the federated graph by name.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetFederatedGraphSDLByName
 */
export const getFederatedGraphSDLByName = createQueryService({
  service: {
    methods: {
      getFederatedGraphSDLByName: {
        name: "GetFederatedGraphSDLByName",
        kind: MethodKind.Unary,
        I: GetFederatedGraphSDLByNameRequest,
        O: GetFederatedGraphSDLByNameResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getFederatedGraphSDLByName;

/**
 * GetSubgraphs returns the list of subgraphs.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetSubgraphs
 */
export const getSubgraphs = createQueryService({
  service: {
    methods: {
      getSubgraphs: {
        name: "GetSubgraphs",
        kind: MethodKind.Unary,
        I: GetSubgraphsRequest,
        O: GetSubgraphsResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getSubgraphs;

/**
 * GetSubgraphByName returns the subgraph by name.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetSubgraphByName
 */
export const getSubgraphByName = createQueryService({
  service: {
    methods: {
      getSubgraphByName: {
        name: "GetSubgraphByName",
        kind: MethodKind.Unary,
        I: GetSubgraphByNameRequest,
        O: GetSubgraphByNameResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getSubgraphByName;

/**
 * GetFederatedSubgraphSDLByName returns the SDL of the subgraph by name.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetFederatedSubgraphSDLByName
 */
export const getFederatedSubgraphSDLByName = createQueryService({
  service: {
    methods: {
      getFederatedSubgraphSDLByName: {
        name: "GetFederatedSubgraphSDLByName",
        kind: MethodKind.Unary,
        I: GetFederatedSubgraphSDLByNameRequest,
        O: GetFederatedSubgraphSDLByNameResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getFederatedSubgraphSDLByName;

/**
 * GetChecksByFederatedGraphName return schema and composition checks that concern a federated graph
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetChecksByFederatedGraphName
 */
export const getChecksByFederatedGraphName = createQueryService({
  service: {
    methods: {
      getChecksByFederatedGraphName: {
        name: "GetChecksByFederatedGraphName",
        kind: MethodKind.Unary,
        I: GetChecksByFederatedGraphNameRequest,
        O: GetChecksByFederatedGraphNameResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getChecksByFederatedGraphName;

/**
 * GetCheckDetails returns changes and composition errors recorded for a check
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetCheckDetails
 */
export const getCheckDetails = createQueryService({
  service: {
    methods: {
      getCheckDetails: {
        name: "GetCheckDetails",
        kind: MethodKind.Unary,
        I: GetCheckDetailsRequest,
        O: GetCheckDetailsResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getCheckDetails;

/**
 * GetFederatedGraphChangelog returns the changelog of the federated graph.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetFederatedGraphChangelog
 */
export const getFederatedGraphChangelog = createQueryService({
  service: {
    methods: {
      getFederatedGraphChangelog: {
        name: "GetFederatedGraphChangelog",
        kind: MethodKind.Unary,
        I: GetFederatedGraphChangelogRequest,
        O: GetFederatedGraphChangelogResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getFederatedGraphChangelog;

/**
 * CreateFederatedGraphToken creates a federated graph token that is consumed by the router to authenticate requests.
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CreateFederatedGraphToken
 */
export const createFederatedGraphToken = createQueryService({
  service: {
    methods: {
      createFederatedGraphToken: {
        name: "CreateFederatedGraphToken",
        kind: MethodKind.Unary,
        I: CreateFederatedGraphTokenRequest,
        O: CreateFederatedGraphTokenResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).createFederatedGraphToken;

/**
 * GetOrganizationMembers returns the list of organization members
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetOrganizationMembers
 */
export const getOrganizationMembers = createQueryService({
  service: {
    methods: {
      getOrganizationMembers: {
        name: "GetOrganizationMembers",
        kind: MethodKind.Unary,
        I: GetOrganizationMembersRequest,
        O: GetOrganizationMembersResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getOrganizationMembers;

/**
 * InviteUser invites an user to join the organization
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.InviteUser
 */
export const inviteUser = createQueryService({
  service: {
    methods: {
      inviteUser: {
        name: "InviteUser",
        kind: MethodKind.Unary,
        I: InviteUserRequest,
        O: InviteUserResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).inviteUser;

/**
 * GetAPIKeys returns a list of API keys of the organization
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetAPIKeys
 */
export const getAPIKeys = createQueryService({
  service: {
    methods: {
      getAPIKeys: {
        name: "GetAPIKeys",
        kind: MethodKind.Unary,
        I: GetAPIKeysRequest,
        O: GetAPIKeysResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getAPIKeys;

/**
 * CreateAPIKey creates an API key for the organization
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.CreateAPIKey
 */
export const createAPIKey = createQueryService({
  service: {
    methods: {
      createAPIKey: {
        name: "CreateAPIKey",
        kind: MethodKind.Unary,
        I: CreateAPIKeyRequest,
        O: CreateAPIKeyResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).createAPIKey;

/**
 * DeleteAPIKey deletes an API key for the organization
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.DeleteAPIKey
 */
export const deleteAPIKey = createQueryService({
  service: {
    methods: {
      deleteAPIKey: {
        name: "DeleteAPIKey",
        kind: MethodKind.Unary,
        I: DeleteAPIKeyRequest,
        O: DeleteAPIKeyResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).deleteAPIKey;

/**
 * RemoveOrganizationMember removes the user from the organization
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.RemoveInvitation
 */
export const removeInvitation = createQueryService({
  service: {
    methods: {
      removeInvitation: {
        name: "RemoveInvitation",
        kind: MethodKind.Unary,
        I: RemoveInvitationRequest,
        O: RemoveInvitationResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).removeInvitation;

/**
 * GetLatestValidRouterConfig returns the router config for the federated graph
 *
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetLatestValidRouterConfig
 */
export const getLatestValidRouterConfig = createQueryService({
  service: {
    methods: {
      getLatestValidRouterConfig: {
        name: "GetLatestValidRouterConfig",
        kind: MethodKind.Unary,
        I: GetConfigRequest,
        O: GetConfigResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getLatestValidRouterConfig;

/**
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetAnalyticsView
 */
export const getAnalyticsView = createQueryService({
  service: {
    methods: {
      getAnalyticsView: {
        name: "GetAnalyticsView",
        kind: MethodKind.Unary,
        I: GetAnalyticsViewRequest,
        O: GetAnalyticsViewResponse,
        idempotency: MethodIdempotency.NoSideEffects,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getAnalyticsView;

/**
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetDashboardAnalyticsView
 */
export const getDashboardAnalyticsView = createQueryService({
  service: {
    methods: {
      getDashboardAnalyticsView: {
        name: "GetDashboardAnalyticsView",
        kind: MethodKind.Unary,
        I: GetDashboardAnalyticsViewRequest,
        O: GetDashboardAnalyticsViewResponse,
        idempotency: MethodIdempotency.NoSideEffects,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getDashboardAnalyticsView;

/**
 * @generated from rpc wg.cosmo.platform.v1.PlatformService.GetTrace
 */
export const getTrace = createQueryService({
  service: {
    methods: {
      getTrace: {
        name: "GetTrace",
        kind: MethodKind.Unary,
        I: GetTraceRequest,
        O: GetTraceResponse,
      },
    },
    typeName: "wg.cosmo.platform.v1.PlatformService",
  },
}).getTrace;
