import { describe, test, expect } from 'vitest';

import { extractOperationNames } from '../src/commands/operations/commands/push.js';


describe('extract operation names', () => {
    test('parse operations without names', () => {
        const contents = `query {
            hello
        }`;
        const operationNames = extractOperationNames(contents);
        expect(operationNames).toEqual([]);
    });
    test('parse operations with names', () => {
        const contents = `query getTaskAndUser {
            getTask(id: "0x3") {
              id
              title
              completed
            }
            queryUser(filter: {username: {eq: "john"}}) {
              username
              name
            }
          }
          
          query completedTasks {
            queryTask(filter: {completed: true}) {
              title
              completed
            }
          }
        `;

        const operationNames = extractOperationNames(contents);
        expect(operationNames).toEqual(['getTaskAndUser', 'completedTasks']);
    });
});
