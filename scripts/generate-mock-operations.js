#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLIENT_NAMES = ['apollo-client', 'relay', 'urql', 'graphql-request'];

const EMPLOYEE_FIELDS = [
  ['id', 'tag', 'currentMood'],
  ['id', 'tag', 'startDate', 'isAvailable'],
  ['id', 'currentMood', 'derivedMood'],
  ['id', 'tag', 'updatedAt', 'startDate'],
  ['id', 'isAvailable', 'currentMood', 'tag'],
  ['id', 'tag', 'notes', 'currentMood']
];

const EMPLOYEE_WITH_DETAILS = [
  ['id', 'tag', 'details { forename surname }'],
  ['id', 'tag', 'details { forename surname hasChildren }'],
  ['id', 'details { forename location { key { name } } }'],
  ['id', 'tag', 'details { nationality maritalStatus }']
];

const PRODUCT_FRAGMENTS = [
  `... on Consultancy { upc name }`,
  `... on Cosmo { upc name repositoryURL }`,
  `... on SDK { upc unicode clientLanguages }`,
  `... on Consultancy { upc name }\n    ... on Cosmo { upc name }`,
  `... on SDK { upc unicode }\n    ... on Cosmo { upc repositoryURL }`
];

function randomVersion() {
  return `${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 10)}`;
}

function randomClientName() {
  return CLIENT_NAMES[Math.floor(Math.random() * CLIENT_NAMES.length)];
}

function randomDelay() {
  return (Math.random() * 3000) + 2000; // 2-5 seconds
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomOperation(index) {
  const opType = Math.random() > 0.5 ? 'query' : 'mutation';

  if (opType === 'query') {
    return generateRandomQuery(index);
  } else {
    return generateRandomMutation(index);
  }
}

function generateRandomQuery(index) {
  const queryType = Math.floor(Math.random() * 10);
  const useDetails = Math.random() > 0.6;
  const fields = useDetails ? randomChoice(EMPLOYEE_WITH_DETAILS) : randomChoice(EMPLOYEE_FIELDS);

  switch (queryType) {
    case 0:
      return {
        type: 'query',
        name: `GetEmployee_${index}`,
        operation: `query GetEmployee_${index}($id: Int!) {
  employee(id: $id) {
    ${fields.join('\n    ')}
  }
}`,
        variables: { id: Math.floor(Math.random() * 100) + 1 }
      };

    case 1:
      return {
        type: 'query',
        name: `GetEmployees_${index}`,
        operation: `query GetEmployees_${index} {
  employees {
    ${randomChoice(EMPLOYEE_FIELDS).join('\n    ')}
  }
}`,
        variables: {}
      };

    case 2:
      return {
        type: 'query',
        name: `GetProducts_${index}`,
        operation: `query GetProducts_${index} {
  products {
    ${randomChoice(PRODUCT_FRAGMENTS)}
  }
}`,
        variables: {}
      };

    case 3:
      return {
        type: 'query',
        name: `GetTeammates_${index}`,
        operation: `query GetTeammates_${index}($team: Department!) {
  teammates(team: $team) {
    ${randomChoice(EMPLOYEE_FIELDS).join('\n    ')}
  }
}`,
        variables: { team: randomChoice(['ENGINEERING', 'MARKETING', 'OPERATIONS']) }
      };

    case 4:
      return {
        type: 'query',
        name: `GetFirstEmployee_${index}`,
        operation: `query GetFirstEmployee_${index} {
  firstEmployee {
    ${fields.join('\n    ')}
  }
}`,
        variables: {}
      };

    case 5:
      const criteriaType = Math.random();
      let criteria;
      if (criteriaType < 0.33) {
        criteria = { id: Math.floor(Math.random() * 100) + 1 };
      } else if (criteriaType < 0.66) {
        criteria = { department: randomChoice(['ENGINEERING', 'MARKETING', 'OPERATIONS']) };
      } else {
        criteria = { title: randomChoice(['Engineer', 'Manager', 'Director']) };
      }
      return {
        type: 'query',
        name: `FindEmployeesBy_${index}`,
        operation: `query FindEmployeesBy_${index}($criteria: FindEmployeeCriteria!) {
  findEmployeesBy(criteria: $criteria) {
    ${randomChoice(EMPLOYEE_FIELDS).join('\n    ')}
  }
}`,
        variables: { criteria }
      };

    case 6:
      const hasCriteria = Math.random() > 0.3;
      const criteriaValue = hasCriteria ? {
        hasPets: Math.random() > 0.5,
        nationality: randomChoice(['AMERICAN', 'DUTCH', 'ENGLISH', 'GERMAN', 'INDIAN', 'SPANISH'])
      } : null;
      return {
        type: 'query',
        name: `FindEmployees_${index}`,
        operation: `query FindEmployees_${index}${hasCriteria ? '($criteria: SearchInput)' : ''} {
  findEmployees${hasCriteria ? '(criteria: $criteria)' : ''} {
    ${randomChoice(EMPLOYEE_FIELDS).join('\n    ')}
  }
}`,
        variables: hasCriteria ? { criteria: criteriaValue } : {}
      };

    case 7:
      return {
        type: 'query',
        name: `GetProductTypes_${index}`,
        operation: `query GetProductTypes_${index} {
  productTypes {
    ${randomChoice(PRODUCT_FRAGMENTS)}
  }
}`,
        variables: {}
      };

    case 8:
      return {
        type: 'query',
        name: `GetTopSecretFacts_${index}`,
        operation: `query GetTopSecretFacts_${index} {
  topSecretFederationFacts {
    description
    factType
  }
}`,
        variables: {}
      };

    case 9:
      return {
        type: 'query',
        name: `GetSharedThings_${index}`,
        operation: `query GetSharedThings_${index}($numOfA: Int!, $numOfB: Int!) {
  sharedThings(numOfA: $numOfA, numOfB: $numOfB) {
    a
  }
}`,
        variables: {
          numOfA: Math.floor(Math.random() * 10) + 1,
          numOfB: Math.floor(Math.random() * 10) + 1
        }
      };

    default:
      return generateRandomQuery(index);
  }
}

function generateRandomMutation(index) {
  const mutationType = Math.floor(Math.random() * 6);

  switch (mutationType) {
    case 0:
      return {
        type: 'mutation',
        name: `UpdateEmployeeTag_${index}`,
        operation: `mutation UpdateEmployeeTag_${index}($id: Int!, $tag: String!) {
  updateEmployeeTag(id: $id, tag: $tag) {
    id
    tag
    ${randomChoice(['updatedAt', 'currentMood', 'isAvailable'])}
  }
}`,
        variables: {
          id: Math.floor(Math.random() * 100) + 1,
          tag: `tag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        }
      };

    case 1:
      return {
        type: 'mutation',
        name: `AddFact_${index}`,
        operation: `mutation AddFact_${index}($fact: TopSecretFactInput!) {
  addFact(fact: $fact) {
    description
    factType
  }
}`,
        variables: {
          fact: {
            title: `Fact-${Date.now()}-${index}`,
            description: `Description-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            factType: randomChoice(['DIRECTIVE', 'ENTITY', 'MISCELLANEOUS'])
          }
        }
      };

    case 2:
      return {
        type: 'mutation',
        name: `UpdateAvailability_${index}`,
        operation: `mutation UpdateAvailability_${index}($employeeID: Int!, $isAvailable: Boolean!) {
  updateAvailability(employeeID: $employeeID, isAvailable: $isAvailable) {
    id
    isAvailable
    ${randomChoice(['currentMood', 'tag', 'updatedAt'])}
  }
}`,
        variables: {
          employeeID: Math.floor(Math.random() * 100) + 1,
          isAvailable: Math.random() > 0.5
        }
      };

    case 3:
      return {
        type: 'mutation',
        name: `UpdateMood_${index}`,
        operation: `mutation UpdateMood_${index}($employeeID: Int!, $mood: Mood!) {
  updateMood(employeeID: $employeeID, mood: $mood) {
    id
    currentMood
    derivedMood
    ${randomChoice(['tag', 'isAvailable'])}
  }
}`,
        variables: {
          employeeID: Math.floor(Math.random() * 100) + 1,
          mood: randomChoice(['HAPPY', 'SAD'])
        }
      };

    case 4:
      return {
        type: 'mutation',
        name: `UpdateEmployeeKafka_${index}`,
        operation: `mutation UpdateEmployeeKafka_${index}($employeeID: Int!, $update: UpdateEmployeeInput!) {
  updateEmployeeMyKafka(employeeID: $employeeID, update: $update) {
    success
  }
}`,
        variables: {
          employeeID: Math.floor(Math.random() * 100) + 1,
          update: {
            name: `Name-${Date.now()}-${index}`,
            email: `email-${Date.now()}-${index}@example.com`
          }
        }
      };

    case 5:
      return {
        type: 'mutation',
        name: `UpdateEmployeeNats_${index}`,
        operation: `mutation UpdateEmployeeNats_${index}($id: Int!, $update: UpdateEmployeeInput!) {
  updateEmployeeMyNats(id: $id, update: $update) {
    success
  }
}`,
        variables: {
          id: Math.floor(Math.random() * 100) + 1,
          update: {
            name: `Name-${Date.now()}-${index}`,
            email: `email-${Date.now()}-${index}@example.com`
          }
        }
      };

    default:
      return generateRandomMutation(index);
  }
}

async function checkExistingOperations() {
  const outputDir = join(__dirname, 'mock-operations');
  try {
    await access(outputDir);
    const files = await readdir(outputDir);
    if (files.length > 0) {
      console.log(`⚠️  Found ${files.length} existing operation files in scripts/mock-operations/`);
      console.log('Press ENTER or SPACE to continue and overwrite...');

      return new Promise((resolve) => {
        const rl = createInterface({ input: stdin, output: stdout });
        stdin.setRawMode(true);
        stdin.resume();

        stdin.once('data', (key) => {
          stdin.setRawMode(false);
          rl.close();

          if (key[0] === 13 || key[0] === 32) { // ENTER or SPACE
            console.log('Continuing...\n');
            resolve(true);
          } else if (key[0] === 3) { // Ctrl+C
            console.log('\nAborted.');
            process.exit(0);
          } else {
            console.log('\nInvalid key. Aborting.');
            process.exit(1);
          }
        });
      });
    }
  } catch (err) {
    console.error(`Check if directory ${outputDir} exists:`, err);
    throw err;
  }
  return true;
}

async function generateOperationFiles(count) {
  const outputDir = join(__dirname, 'mock-operations');
  await mkdir(outputDir, { recursive: true });

  const operations = [];
  for (let i = 0; i < count; i++) {
    const op = generateRandomOperation(i + 1);
    const filename = `${String(i + 1).padStart(3, '0')}-${op.name}.json`;
    const filepath = join(outputDir, filename);

    const operationData = {
      name: op.name,
      type: op.type,
      operation: op.operation,
      variables: op.variables,
      clientName: randomClientName(),
      clientVersion: randomVersion()
    };

    await writeFile(filepath, JSON.stringify(operationData, null, 2));
    operations.push({ filepath, data: operationData });
  }

  return operations;
}

async function executeOperations(endpoint, token, operations) {
  const batches = [];
  for (let i = 0; i < operations.length; i += 15) {
    batches.push(operations.slice(i, i + 15));
  }

  console.log(`Executing ${operations.length} operations in ${batches.length} batches...`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`\nBatch ${batchIndex + 1}/${batches.length} (${batch.length} operations)`);

    const promises = batch.map(async ({ filepath, data }) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WG-Token': token,
            'GraphQL-Client-Name': data.clientName,
            'GraphQL-Client-Version': data.clientVersion
          },
          body: JSON.stringify({
            query: data.operation,
            variables: data.variables
          })
        });

        const result = await response.json();
        const status = response.ok ? '✓' : '✗';
        console.log(`  ${status} ${data.name} (${data.clientName}@${data.clientVersion})`);

        if (!response.ok || result.errors) {
          console.log(`    Error: ${JSON.stringify(result.errors || result)}`);
        }

        return { filepath, success: response.ok && !result.errors, result };
      } catch (error) {
        console.log(`  ✗ ${data.name} - ${error.message}`);
        return { filepath, success: false, error: error.message };
      }
    });

    await Promise.all(promises);

    if (batchIndex < batches.length - 1) {
      const delay = randomDelay();
      console.log(`  Waiting ${(delay / 1000).toFixed(1)}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      endpoint: {
        type: 'string',
        short: 'e'
      },
      token: {
        type: 'string',
        short: 't'
      },
      count: {
        type: 'string',
        short: 'c'
      }
    }
  });

  if (!values.endpoint || !values.token || !values.count) {
    console.error('Usage: ./generate-mock-operations.js --endpoint <url> --token <token> --count <number>');
    console.error('Example: ./generate-mock-operations.js -e http://localhost:3002/graphql -t mytoken -c 50');
    process.exit(1);
  }

  const count = parseInt(values.count, 10);
  if (isNaN(count) || count <= 0) {
    console.error('Error: count must be a positive number');
    process.exit(1);
  }

  await checkExistingOperations();

  console.log(`Generating ${count} randomized operations...`);
  const operations = await generateOperationFiles(count);
  console.log(`✓ Generated ${operations.length} operation files in scripts/mock-operations/\n`);

  console.log(`Executing operations against ${values.endpoint}...`);
  await executeOperations(values.endpoint, values.token, operations);

  console.log('\n✓ Done!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
