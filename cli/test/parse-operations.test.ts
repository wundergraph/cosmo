import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect } from 'vitest';

import { parseOperations } from '../src/commands/operations/commands/push';


describe('parse operations from different formats', () => {
    test('parse operations from graphql', () => {
        const operations = parseOperations(`
            query {
                hello
            }
        `);
        expect(operations).toEqual([`
            query {
                hello
            }
        `]);
    });
    test('parse operations from Apollo', async() => {
        const persistedQueries = await fs.readFile(path.join('test', 'testdata', 'persisted-query-manifest.json'), 'utf8');
        const operations = parseOperations(persistedQueries);
        expect(operations).toEqual([
            "query Employees {\n employees {\n id\n }\n}"
        ]);
    });
    test('parse query map', async() => {
        const queryMap = await fs.readFile(path.join('test', 'testdata', 'query-map.json'), 'utf8');
        const operations = parseOperations(queryMap);
        expect(operations).toEqual([
            "subscription {\n currentTime {\n unixTime \n }\n}",
            "query { employee(id:1) { id } }"
        ]);
    });
})
