import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect } from 'vitest';

import { parseOperations } from '../src/commands/operations/commands/push.js';


describe('parse operations from different formats', () => {
    test('parse operations from graphql', () => {
        const operation = `query {
            hello
        }`;
        const id = crypto.createHash('sha256').update(operation).digest('hex');
        const operations = parseOperations(operation);
        expect(operations).toEqual([{ id, contents: operation }]);
    });
    test('parse operations from Apollo', async() => {
        const persistedQueries = await fs.readFile(path.join('test', 'testdata', 'persisted-query-manifest.json'), 'utf8');
        const operations = parseOperations(persistedQueries);
        expect(operations).toEqual([
            { id: "2d9df67f96ce804da7a9107d33373132a53bf56aec29ef4b4e06569a43a16935", contents: "query Employees {\n employees {\n id\n }\n}" },
        ]);
    });
    test('parse query map', async() => {
        const queryMap = await fs.readFile(path.join('test', 'testdata', 'query-map.json'), 'utf8');
        const operations = parseOperations(queryMap);
        expect(operations).toEqual([
            { id: "1", contents: "subscription {\n currentTime {\n unixTime \n }\n}" },
            { id: "2", contents: "query { employee(id:1) { id } }" },
        ]);
    });
    test('parse relay persisted', async() => {
        const persisted = await fs.readFile(path.join('test', 'testdata', 'relay-persisted.json'), 'utf8');
        const operations = parseOperations(persisted);
        const op1 = "query DragonsListDragonsQuery {\n  spacex_dragons {\n    ...Dragons_display_details\n    id\n  }\n}\n\nfragment Dragons_display_details on spacex_Dragon {\n  name\n  active\n}\n";
        const op2 = "query DragonsListDragonsQuery {\n  spacex_dragons {\n    name\n    active\n    id\n  }\n}\n";
        expect(operations).toEqual([
            { id: "c11158afcc8e55409b96972f20e26fa1", contents: op1 },
            { id: "ce2342daed4e1960717c581d645e335d", contents: op2 },
        ]);
    });
})
