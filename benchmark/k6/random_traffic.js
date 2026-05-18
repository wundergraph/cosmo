// Random traffic generator for the **employees** federated demo.
//
// Pounds the router at $BASE_URL (default http://localhost:3002/graphql) with
// a weighted random mix of queries + mutations that, taken together, exercise
// nearly every root field and most leaf fields across every subgraph in
// demo/pkg/subgraphs/. Subscriptions are intentionally skipped.
//
// Subgraph coverage:
//   employees        — employee/employeeAsList/employees/products/teammates/
//                      firstEmployee/findEmployeesBy, updateEmployeeTag,
//                      Employee {details,tag,expertise,role,notes,updatedAt,
//                      currentMood,derivedMood,isAvailable,primaryWorkItem,
//                      lastWorkReview,workSetup}, Products union, RoleType
//                      hierarchy, Country (via location), pets via family.
//   family           — findEmployees, Employee.details.{hasChildren,
//                      maritalStatus,nationality,pets[Pet hierarchy]}.
//   hobbies          — Employee.hobbies (every Hobby concrete type).
//   products         — productTypes, sharedThings, slicedThings, Products union
//                      (Consultancy/Cosmo/Documentation/SDK with url/urls).
//   products_fg      — same productTypes shape; reached via the products surface
//                      plus Employee.productCount.
//   availability     — updateAvailability + Employee.isAvailable.
//   mood             — updateMood + Employee.currentMood.
//   countries        — Country.{key{name},language} via Employee/Travelling.
//   employeeupdated  — skipped by default (NATS/Kafka/Redis dependent).
//   test1            — skipped entirely (synthetic edge-case subgraph).
//   projects         — projects/project/projectStatuses/projectsByStatus/
//                      projectResources/searchProjects/milestones/tasks/
//                      projectActivities/projectTags/archivedProjects/
//                      tasksByPriority/resourceMatrix/nodesById, every mutation,
//                      and Employee.{projects,assignedTasks,completedTasks,
//                      skills,certifications,projectHistory,workItemInfo,
//                      reviewReport,workSetupSummary,currentWorkload,
//                      averageTaskCompletionDays,totalProjectCount}.
//   courses          — courses/course/lessons, addCourse/addLesson +
//                      Employee.taughtCourses.
//
// Intentionally excluded (will error / require infra):
//   - Subscriptions (all subgraphs).
//   - employeeupdated event mutations + queries (NATS/Kafka/Redis).
//   - test1 subgraph (header/payload/delay/big/long/rootFieldWith* etc.).
//   - File-upload mutations (multipart isn't built here).
//   - @requiresScopes / @authenticated fields by default
//     (topSecretFederationFacts/factTypes/addFact/Employee.startDate).
//     Set ENABLE_AUTH_OPS=true plus AUTH_HEADER='Bearer <jwt>' to include them.
//   - kill*/panic/throwError*/rootFieldThrowsError/fieldThrowsError/returnsError.
//
// Env vars:
//   BASE_URL            default "http://localhost:3002/graphql"
//   VUS                 default 10
//   DURATION            default "60s"
//   MUTATION_RATE       default 0.1
//   ENABLE_AUTH_OPS     "true" to include @requiresScopes / @authenticated ops
//   AUTH_HEADER         e.g. "Bearer <jwt>"; sent on every request when set
//   OPS_WEIGHTS_JSON    JSON override, e.g. '{"addProject":0,"panicQuery":0}'
//   FAIL_ON_ERRORS      "true" to log payload+body on first error
//
// Run:
//   k6 run benchmark/k6/random_traffic.js
//   k6 run -e VUS=30 -e DURATION=3m -e MUTATION_RATE=0.15 \
//          benchmark/k6/random_traffic.js

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { randomIntBetween, randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3002/graphql";
const VUS = parseInt(__ENV.VUS || "10", 10);
const DURATION = __ENV.DURATION || "60s";
const MUTATION_RATE = parseFloat(__ENV.MUTATION_RATE || "0.1");
const ENABLE_AUTH_OPS = (__ENV.ENABLE_AUTH_OPS || "false").toLowerCase() === "true";
const AUTH_HEADER = __ENV.AUTH_HEADER || "";
const FAIL_ON_ERRORS = (__ENV.FAIL_ON_ERRORS || "false").toLowerCase() === "true";
const WEIGHT_OVERRIDES = (() => {
  try {
    return JSON.parse(__ENV.OPS_WEIGHTS_JSON || "{}");
  } catch (_e) {
    return {};
  }
})();

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const graphqlErrorRate = new Rate("graphql_error_rate");
const httpErrorRate = new Rate("http_error_rate");
const opCount = new Counter("op_count");
const opDuration = new Trend("op_duration_ms", true);

// ---------------------------------------------------------------------------
// Seed values matched to demo/pkg/subgraphs data.
// ---------------------------------------------------------------------------

const EMPLOYEE_IDS = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12];
const DEPARTMENTS = ["ENGINEERING", "MARKETING", "OPERATIONS"];
const ENGINEER_TYPES = ["BACKEND", "FRONTEND", "FULLSTACK"];
const OPERATION_TYPES = ["FINANCE", "HUMAN_RESOURCES"];
const NATIONALITIES = ["AMERICAN", "DUTCH", "ENGLISH", "GERMAN", "INDIAN", "SPANISH", "UKRAINIAN"];
const MARITAL_STATUSES = ["ENGAGED", "MARRIED"];
const MOODS = ["HAPPY", "SAD"]; // APATHETIC is @inaccessible
const PRODUCT_NAMES = ["CONSULTANCY", "COSMO", "ENGINE", "FINANCE", "HUMAN_RESOURCES", "MARKETING", "SDK"];
const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "COMPLETED", "ON_HOLD"];
const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"];
const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "COMPLETED", "BLOCKED"];
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SAMPLE_IDS = ["1", "2", "3", "4", "5"];

// ---------------------------------------------------------------------------
// Reusable GraphQL fragments. The Employee fragment fans out across every
// subgraph that contributes to Employee: employees, family, hobbies,
// availability, mood, products, products_fg, projects, courses, countries.
// ---------------------------------------------------------------------------

const EMPLOYEE_DEEP = `
  fragment EmployeeDeep on Employee {
    id
    tag
    expertise
    notes
    updatedAt
    isAvailable
    currentMood
    derivedMood
    details {
      forename
      surname
      hasChildren
      maritalStatus
      nationality
      location { key { name } language }
      pastLocations { type name country { key { name } language } }
      pets {
        class gender
        ... on Cat { name type }
        ... on Dog { name breed }
        ... on Alligator { name dangerous }
        ... on Mouse { name }
        ... on Pony { name }
      }
    }
    role {
      departments
      title
      ... on Engineer { engineerType }
      ... on Operator { operatorType }
    }
    hobbies {
      ... on Exercise { category }
      ... on Flying { planeModels yearsOfExperience }
      ... on Gaming { genres name yearsOfExperience }
      ... on Other { name }
      ... on Programming { languages }
      ... on Travelling { countriesLived { key { name } language } }
    }
    products
    productCount
    taughtCourses { id title description }
    projects { id name status }
    assignedTasks { id name status priority }
    completedTasks { id name }
    skills
    certifications
    workItemInfo
    reviewReport
    workSetupSummary
    currentWorkload(includeCompleted: true)
    totalProjectCount
    primaryWorkItem {
      __typename name priority
      ... on TechnicalWorkItem { codeCount handler { name } specs { name complexity metrics { score efficiency } } }
      ... on ManagementWorkItem { teamSize handler { name } specs { name scope metrics { score efficiency } } }
    }
    lastWorkReview {
      __typename
      ... on WorkApproval { comment approvedAt }
      ... on WorkRejection { reason rejectionCode }
    }
    workSetup { priority primaryItem { __typename name priority } }
  }
`;

const PRODUCTS_UNION = `
  ... on Consultancy { upc name lead { id } isLeadAvailable }
  ... on Cosmo { upc name repositoryURL engineers { id } lead { id } isLeadAvailable }
  ... on Documentation { url(product: COSMO) urls(products: [COSMO, SDK]) }
  ... on SDK { upc unicode owner { id } engineers { id } clientLanguages }
`;

const PROJECT_DEEP = `
  fragment ProjectDeep on Project {
    id name description status startDate endDate progress
    tags milestoneIds
    teamMembers { id }
    relatedProducts { upc }
    milestones { id name status completionPercentage }
    tasks { id name status priority }
    completionRate(includeSubtasks: true)
    taskCount
    activeMilestoneCount
    subProjects(includeArchived: false) { id name status }
  }
`;

// ---------------------------------------------------------------------------
// Operation pool. Each entry's `build()` returns { query, variables, headers }.
// `auth: true` marks operations that depend on @requiresScopes / @authenticated.
// ---------------------------------------------------------------------------

const OPERATIONS = [
  // ============================================================ employees ===
  {
    name: "employee",
    weight: 10,
    build: () => ({
      query: `${EMPLOYEE_DEEP}
        query Employee($id: Int!) { employee(id: $id) { ...EmployeeDeep } }`,
      variables: { id: randomItem(EMPLOYEE_IDS) },
    }),
  },
  {
    name: "employeeAsList",
    weight: 4,
    build: () => ({
      query: `${EMPLOYEE_DEEP}
        query EmployeeAsList($id: Int!) { employeeAsList(id: $id) { ...EmployeeDeep } }`,
      variables: { id: randomItem(EMPLOYEE_IDS) },
    }),
  },
  {
    name: "employees",
    weight: 6,
    build: () => ({
      query: `${EMPLOYEE_DEEP}
        query Employees { employees { ...EmployeeDeep } }`,
      variables: {},
    }),
  },
  {
    name: "teammates",
    weight: 5,
    build: () => ({
      query: `${EMPLOYEE_DEEP}
        query Teammates($team: Department!) { teammates(team: $team) { ...EmployeeDeep } }`,
      variables: { team: randomItem(DEPARTMENTS) },
    }),
  },
  {
    name: "firstEmployee",
    weight: 3,
    build: () => ({
      query: `${EMPLOYEE_DEEP} query FirstEmployee { firstEmployee { ...EmployeeDeep } }`,
      variables: {},
    }),
  },
  {
    name: "findEmployeesBy_id",
    weight: 3,
    build: () => ({
      query: `query FindByID($criteria: FindEmployeeCriteria!) {
        findEmployeesBy(criteria: $criteria) { id tag details { forename surname } }
      }`,
      variables: { criteria: { id: randomItem(EMPLOYEE_IDS) } },
    }),
  },
  {
    name: "findEmployeesBy_department",
    weight: 3,
    build: () => ({
      query: `query FindByDept($criteria: FindEmployeeCriteria!) {
        findEmployeesBy(criteria: $criteria) { id role { departments title } }
      }`,
      variables: { criteria: { department: randomItem(DEPARTMENTS) } },
    }),
  },
  {
    name: "findEmployeesBy_title",
    weight: 3,
    build: () => ({
      query: `query FindByTitle($criteria: FindEmployeeCriteria!) {
        findEmployeesBy(criteria: $criteria) { id role { title } }
      }`,
      variables: { criteria: { title: randomItem(["Senior Engineer", "Director", "Engineer", "Manager"]) } },
    }),
  },
  {
    name: "rootProducts",
    weight: 4,
    build: () => ({
      query: `query RootProducts { products { __typename ${PRODUCTS_UNION} } }`,
      variables: {},
    }),
  },
  {
    name: "updateEmployeeTag",
    weight: 4,
    isMutation: true,
    build: () => ({
      query: `mutation UpdateTag($id: Int!, $tag: String!) {
        updateEmployeeTag(id: $id, tag: $tag) { id tag }
      }`,
      variables: {
        id: randomItem(EMPLOYEE_IDS),
        tag: `k6-${randomIntBetween(1, 1_000_000)}`,
      },
    }),
  },

  // =============================================================== family ===
  {
    name: "findEmployees_family",
    weight: 5,
    build: () => ({
      query: `query FindFamily($criteria: SearchInput) {
        findEmployees(criteria: $criteria) {
          id
          details {
            forename surname middlename hasChildren maritalStatus nationality
            pets { class gender ... on Cat { name type } ... on Dog { name breed } ... on Alligator { name dangerous } }
          }
        }
      }`,
      variables: {
        criteria: {
          hasPets: Math.random() < 0.5,
          nationality: randomItem(NATIONALITIES),
          nested: {
            maritalStatus: Math.random() < 0.5 ? randomItem(MARITAL_STATUSES) : null,
            hasChildren: Math.random() < 0.5,
          },
        },
      },
    }),
  },

  // ============================================================= products ===
  {
    name: "productTypes",
    weight: 4,
    build: () => ({
      query: `query ProductTypes { productTypes { __typename ${PRODUCTS_UNION} } }`,
      variables: {},
    }),
  },
  {
    name: "sharedThings",
    weight: 3,
    build: () => ({
      query: `query SharedThings($a: Int!, $b: Int!) {
        sharedThings(numOfA: $a, numOfB: $b) { a b }
      }`,
      variables: { a: randomIntBetween(1, 5), b: randomIntBetween(1, 5) },
    }),
  },
  {
    name: "slicedThings",
    weight: 2,
    build: () => ({
      query: `query SlicedThings($first: Int) { slicedThings(first: $first) { a } }`,
      variables: { first: randomIntBetween(1, 5) },
    }),
  },
  {
    name: "factTypes",
    weight: 1,
    auth: true,
    build: () => ({
      query: `query FactTypes { factTypes }`,
      variables: {},
    }),
  },
  {
    name: "topSecretFederationFacts",
    weight: 1,
    auth: true,
    build: () => ({
      query: `query TopSecret {
        topSecretFederationFacts {
          __typename description factType
          ... on DirectiveFact { title }
          ... on EntityFact { title }
          ... on MiscellaneousFact { title }
        }
      }`,
      variables: {},
    }),
  },
  {
    name: "addFact",
    weight: 1,
    isMutation: true,
    auth: true,
    build: () => ({
      query: `mutation AddFact($fact: TopSecretFactInput!) {
        addFact(fact: $fact) { __typename description factType }
      }`,
      variables: {
        fact: {
          title: `k6-fact-${randomIntBetween(1, 1_000_000)}`,
          description: "k6 generated description",
          factType: randomItem(["DIRECTIVE", "ENTITY", "MISCELLANEOUS"]),
        },
      },
    }),
  },

  // ========================================================= availability ===
  {
    name: "updateAvailability",
    weight: 3,
    isMutation: true,
    build: () => ({
      query: `mutation UpdateAvail($id: Int!, $avail: Boolean!) {
        updateAvailability(employeeID: $id, isAvailable: $avail) { id isAvailable }
      }`,
      variables: { id: randomItem(EMPLOYEE_IDS), avail: Math.random() < 0.5 },
    }),
  },

  // ================================================================= mood ===
  {
    name: "updateMood",
    weight: 3,
    isMutation: true,
    build: () => ({
      query: `mutation UpdateMood($id: Int!, $mood: Mood!) {
        updateMood(employeeID: $id, mood: $mood) { id currentMood }
      }`,
      variables: { id: randomItem(EMPLOYEE_IDS), mood: randomItem(MOODS) },
    }),
  },

  // ============================================================= projects ===
  {
    name: "projects",
    weight: 6,
    build: () => ({
      query: `${PROJECT_DEEP} query Projects { projects { ...ProjectDeep } }`,
      variables: {},
    }),
  },
  {
    name: "project",
    weight: 5,
    build: () => ({
      query: `${PROJECT_DEEP} query Project($id: ID!) { project(id: $id) { ...ProjectDeep } }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "projectStatuses",
    weight: 2,
    build: () => ({
      query: `query ProjectStatuses { projectStatuses }`,
      variables: {},
    }),
  },
  {
    name: "projectsByStatus",
    weight: 4,
    build: () => ({
      query: `${PROJECT_DEEP}
        query ByStatus($status: ProjectStatus!) {
          projectsByStatus(status: $status) { ...ProjectDeep }
        }`,
      variables: { status: randomItem(PROJECT_STATUSES) },
    }),
  },
  {
    name: "projectResources",
    weight: 3,
    build: () => ({
      query: `query Resources($id: ID!) {
        projectResources(projectId: $id) {
          __typename
          ... on Employee { id tag }
          ... on Product { upc }
          ... on Milestone { id name status }
          ... on Task { id name status }
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "searchProjects",
    weight: 3,
    build: () => ({
      query: `query Search($q: String!) {
        searchProjects(query: $q) {
          __typename
          ... on Project { id name status }
          ... on Milestone { id name }
          ... on Task { id name }
        }
      }`,
      variables: { q: randomItem(["alpha", "beta", "cosmo", "demo", "k6"]) },
    }),
  },
  {
    name: "milestones",
    weight: 3,
    build: () => ({
      query: `query Milestones($id: ID!) {
        milestones(projectId: $id) {
          id name status completionPercentage
          dependencies { id name }
          subtasks { id name }
          reviewers { id }
          isAtRisk(threshold: 0.5)
          daysUntilDue
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "tasks",
    weight: 3,
    build: () => ({
      query: `query Tasks($id: ID!) {
        tasks(projectId: $id) {
          id name status priority actualHours
          labels subtasks { id } dependencies { id } attachmentUrls reviewerIds
          isBlocked(checkDependencies: true)
          totalEffort(includeSubtasks: true)
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "projectActivities",
    weight: 2,
    build: () => ({
      query: `query Activities($id: ID!) {
        projectActivities(projectId: $id) {
          __typename
          ... on ProjectUpdate { id updateType description timestamp }
          ... on Milestone { id name }
          ... on Task { id name }
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "projectTags",
    weight: 1,
    build: () => ({
      query: `query ProjectTags { projectTags }`,
      variables: {},
    }),
  },
  {
    name: "archivedProjects",
    weight: 2,
    build: () => ({
      query: `${PROJECT_DEEP} query Archived { archivedProjects { ...ProjectDeep } }`,
      variables: {},
    }),
  },
  {
    name: "tasksByPriority",
    weight: 2,
    build: () => ({
      query: `query TBP($id: ID!) { tasksByPriority(projectId: $id) { id name priority } }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "resourceMatrix",
    weight: 2,
    build: () => ({
      query: `query Matrix($id: ID!) {
        resourceMatrix(projectId: $id) {
          __typename
          ... on Employee { id }
          ... on Product { upc }
          ... on Milestone { id }
          ... on Task { id }
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "nodesById",
    weight: 2,
    build: () => ({
      query: `query Nodes($id: ID!) {
        nodesById(id: $id) {
          __typename
          ... on Project { id name }
          ... on Milestone { id name }
          ... on Task { id name }
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "addProject",
    weight: 2,
    isMutation: true,
    build: () => ({
      query: `mutation AddProject($p: ProjectInput!) {
        addProject(project: $p) { id name status }
      }`,
      variables: {
        p: {
          name: `k6-project-${randomIntBetween(1, 1_000_000)}`,
          description: "k6 random traffic",
          status: randomItem(PROJECT_STATUSES),
        },
      },
    }),
  },
  {
    name: "addMilestone",
    weight: 2,
    isMutation: true,
    build: () => ({
      query: `mutation AddMilestone($m: MilestoneInput!) {
        addMilestone(milestone: $m) { id name status }
      }`,
      variables: {
        m: {
          projectId: randomItem(SAMPLE_IDS),
          name: `k6-milestone-${randomIntBetween(1, 1_000_000)}`,
          status: randomItem(MILESTONE_STATUSES),
        },
      },
    }),
  },
  {
    name: "addTask",
    weight: 2,
    isMutation: true,
    build: () => ({
      query: `mutation AddTask($t: TaskInput!) {
        addTask(task: $t) { id name status priority }
      }`,
      variables: {
        t: {
          projectId: randomItem(SAMPLE_IDS),
          assigneeId: randomItem(EMPLOYEE_IDS),
          name: `k6-task-${randomIntBetween(1, 1_000_000)}`,
          priority: randomItem(TASK_PRIORITIES),
          status: randomItem(TASK_STATUSES),
          estimatedHours: randomIntBetween(1, 40),
        },
      },
    }),
  },
  {
    name: "updateProjectStatus",
    weight: 2,
    isMutation: true,
    build: () => ({
      query: `mutation UpdStatus($id: ID!, $s: ProjectStatus!) {
        updateProjectStatus(projectId: $id, status: $s) {
          id projectId updateType description timestamp
        }
      }`,
      variables: { id: randomItem(SAMPLE_IDS), s: randomItem(PROJECT_STATUSES) },
    }),
  },

  // ============================================================== courses ===
  {
    name: "courses",
    weight: 4,
    build: () => ({
      query: `query Courses {
        courses {
          id title description
          instructor { id details { forename surname } }
          lessons { id title order }
        }
      }`,
      variables: {},
    }),
  },
  {
    name: "course",
    weight: 3,
    build: () => ({
      query: `query Course($id: ID!) {
        course(id: $id) { id title description lessons { id title order } }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "lessons",
    weight: 3,
    build: () => ({
      query: `query Lessons($id: ID!) {
        lessons(courseId: $id) { id courseId title order course { id title } }
      }`,
      variables: { id: randomItem(SAMPLE_IDS) },
    }),
  },
  {
    name: "addCourse",
    weight: 1,
    isMutation: true,
    build: () => ({
      query: `mutation AddCourse($t: String!, $i: Int!) {
        addCourse(title: $t, instructorId: $i) { id title }
      }`,
      variables: {
        t: `k6-course-${randomIntBetween(1, 1_000_000)}`,
        i: randomItem(EMPLOYEE_IDS),
      },
    }),
  },
  {
    name: "addLesson",
    weight: 1,
    isMutation: true,
    build: () => ({
      query: `mutation AddLesson($c: ID!, $t: String!, $o: Int!) {
        addLesson(courseId: $c, title: $t, order: $o) { id title order }
      }`,
      variables: {
        c: randomItem(SAMPLE_IDS),
        t: `k6-lesson-${randomIntBetween(1, 1_000_000)}`,
        o: randomIntBetween(1, 20),
      },
    }),
  },
];

// Apply weight overrides and gate auth-only ops behind ENABLE_AUTH_OPS.
for (const op of OPERATIONS) {
  if (Object.prototype.hasOwnProperty.call(WEIGHT_OVERRIDES, op.name)) {
    op.weight = Math.max(0, Number(WEIGHT_OVERRIDES[op.name]) || 0);
  }
  if (op.auth && !ENABLE_AUTH_OPS) {
    op.weight = 0;
  }
}

const READS = OPERATIONS.filter((o) => !o.isMutation && o.weight > 0);
const WRITES = OPERATIONS.filter((o) => o.isMutation && o.weight > 0);

function pickWeighted(pool) {
  const total = pool.reduce((acc, o) => acc + o.weight, 0);
  let r = Math.random() * total;
  for (const op of pool) {
    r -= op.weight;
    if (r <= 0) return op;
  }
  return pool[pool.length - 1];
}

function chooseOp() {
  const pool = WRITES.length > 0 && Math.random() < MUTATION_RATE ? WRITES : READS;
  return pickWeighted(pool);
}

// ---------------------------------------------------------------------------
// setup() — log the surface that will be exercised.
// ---------------------------------------------------------------------------

export function setup() {
  const enabled = OPERATIONS.filter((o) => o.weight > 0).map(
    (o) => `${o.isMutation ? "M" : "Q"} ${o.name} (w=${o.weight}${o.auth ? ", auth" : ""})`,
  );
  const disabled = OPERATIONS.filter((o) => o.weight === 0).map((o) => o.name);
  console.log(`random_traffic -> ${BASE_URL}`);
  console.log(`vus=${VUS} duration=${DURATION} mutation_rate=${MUTATION_RATE} auth_ops=${ENABLE_AUTH_OPS}`);
  console.log(`enabled (${enabled.length}):\n  ${enabled.join("\n  ")}`);
  if (disabled.length) console.log(`disabled: ${disabled.join(", ")}`);
  return {};
}

// ---------------------------------------------------------------------------
// Per-iteration: pick → fire → record.
// ---------------------------------------------------------------------------

export default function () {
  const op = chooseOp();
  const built = op.build();
  const body = JSON.stringify({
    operationName: extractOperationName(built.query),
    query: built.query,
    variables: built.variables || {},
  });
  const headers = Object.assign(
    { "content-type": "application/json" },
    AUTH_HEADER ? { Authorization: AUTH_HEADER } : {},
    built.headers || {},
  );

  const res = http.post(BASE_URL, body, { headers, tags: { op: op.name } });

  opCount.add(1, { op: op.name });
  opDuration.add(res.timings.duration, { op: op.name });

  const httpOk = res.status === 200;
  httpErrorRate.add(!httpOk, { op: op.name });

  let parsed = null;
  if (httpOk) {
    try {
      parsed = res.json();
    } catch (_e) {
      // fall through; counts as a graphql error below
    }
  }
  const hasErrors = !parsed || (Array.isArray(parsed.errors) && parsed.errors.length > 0);
  graphqlErrorRate.add(hasErrors, { op: op.name });

  check(res, { "http 200": (r) => r.status === 200 });
  check({ hasErrors }, { "no graphql errors": (d) => !d.hasErrors });

  if (FAIL_ON_ERRORS && hasErrors) {
    console.error(
      `op=${op.name} status=${res.status} body=${res.body && String(res.body).slice(0, 500)}`,
    );
  }
}

function extractOperationName(query) {
  const m = /(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  return m ? m[1] : undefined;
}
