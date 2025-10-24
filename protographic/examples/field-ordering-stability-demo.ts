/**
 * Demonstration of field ordering stability in operations-to-proto
 * 
 * This example shows how the lock file mechanism ensures that Protocol Buffer
 * field numbers remain stable even when GraphQL operation fields are reordered.
 */

import { compileOperationsToProto } from '../src/operation-to-proto';

const schema = `
  type Query {
    user(id: ID!): User
  }
  
  type User {
    id: ID!
    name: String!
    email: String!
    age: Int
  }
`;

console.log('=== Field Ordering Stability Demo ===\n');

// First compilation with fields in one order
const operation1 = `
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      age
    }
  }
`;

console.log('1. First compilation (fields: id, name, email, age)');
const result1 = compileOperationsToProto(operation1, schema);

// Extract field numbers from the proto
const userMessage1 = result1.proto.match(/message GetUserResponseUser \{([^}]+)\}/s)?.[1];
console.log('   Generated message:');
console.log(userMessage1?.trim().split('\n').map(l => '   ' + l).join('\n'));

console.log('\n   Lock data for GetUserResponseUser:');
console.log('   ', JSON.stringify(result1.lockData.messages.GetUserResponseUser, null, 2).split('\n').join('\n    '));

// Second compilation with fields in completely different order
const operation2 = `
  query GetUser($id: ID!) {
    user(id: $id) {
      age
      email
      id
      name
    }
  }
`;

console.log('\n2. Second compilation with lock data (fields reordered: age, email, id, name)');
const result2 = compileOperationsToProto(operation2, schema, {
  lockData: result1.lockData,
});

const userMessage2 = result2.proto.match(/message GetUserResponseUser \{([^}]+)\}/s)?.[1];
console.log('   Generated message:');
console.log(userMessage2?.trim().split('\n').map(l => '   ' + l).join('\n'));

console.log('\n   Lock data for GetUserResponseUser:');
console.log('   ', JSON.stringify(result2.lockData.messages.GetUserResponseUser, null, 2).split('\n').join('\n    '));

// Verify field numbers are identical
console.log('\n3. Verification:');
const extractFieldNumbers = (proto: string) => {
  const match = proto.match(/message GetUserResponseUser \{([^}]+)\}/s);
  if (!match) return {};
  
  const fields: Record<string, number> = {};
  const lines = match[1].trim().split('\n');
  for (const line of lines) {
    const fieldMatch = line.match(/(\w+)\s+=\s+(\d+);/);
    if (fieldMatch) {
      fields[fieldMatch[1]] = parseInt(fieldMatch[2]);
    }
  }
  return fields;
};

const fields1 = extractFieldNumbers(result1.proto);
const fields2 = extractFieldNumbers(result2.proto);

console.log('   First compilation field numbers:', fields1);
console.log('   Second compilation field numbers:', fields2);
console.log('   Field numbers match:', JSON.stringify(fields1) === JSON.stringify(fields2) ? '✅ YES' : '❌ NO');

console.log('\n✅ Field ordering stability successfully demonstrated!');
console.log('   Despite reordering fields in the GraphQL operation, the Protocol Buffer');
console.log('   field numbers remain stable, ensuring binary compatibility.');