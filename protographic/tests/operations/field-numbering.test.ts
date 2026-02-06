import { describe, expect, test } from 'vitest';
import { createFieldNumberManager } from '../../src/index.js';

describe('Field Numbering', () => {
  describe('createFieldNumberManager', () => {
    test('should create a field number manager', () => {
      const manager = createFieldNumberManager();
      expect(manager).toBeDefined();
      expect(manager.getNextFieldNumber).toBeDefined();
      expect(manager.assignFieldNumber).toBeDefined();
      expect(manager.getFieldNumber).toBeDefined();
      expect(manager.resetMessage).toBeDefined();
      expect(manager.resetAll).toBeDefined();
    });
  });

  describe('getNextFieldNumber', () => {
    test('should return 1 for first field', () => {
      const manager = createFieldNumberManager();
      expect(manager.getNextFieldNumber('TestMessage')).toBe(1);
    });

    test('should return sequential numbers', () => {
      const manager = createFieldNumberManager();
      expect(manager.getNextFieldNumber('TestMessage')).toBe(1);
      expect(manager.getNextFieldNumber('TestMessage')).toBe(2);
      expect(manager.getNextFieldNumber('TestMessage')).toBe(3);
    });

    test('should track numbers independently per message', () => {
      const manager = createFieldNumberManager();

      expect(manager.getNextFieldNumber('Message1')).toBe(1);
      expect(manager.getNextFieldNumber('Message2')).toBe(1);
      expect(manager.getNextFieldNumber('Message1')).toBe(2);
      expect(manager.getNextFieldNumber('Message2')).toBe(2);
    });
  });

  describe('assignFieldNumber', () => {
    test('should assign a specific field number', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 5);
      expect(manager.getFieldNumber('TestMessage', 'field1')).toBe(5);
    });

    test('should update next field number after assignment', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 5);
      expect(manager.getNextFieldNumber('TestMessage')).toBe(6);
    });

    test('should handle assignment of multiple fields', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 1);
      manager.assignFieldNumber('TestMessage', 'field2', 2);
      manager.assignFieldNumber('TestMessage', 'field3', 3);

      expect(manager.getFieldNumber('TestMessage', 'field1')).toBe(1);
      expect(manager.getFieldNumber('TestMessage', 'field2')).toBe(2);
      expect(manager.getFieldNumber('TestMessage', 'field3')).toBe(3);
    });

    test('should not affect next field number if assigned number is lower', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 10);
      expect(manager.getNextFieldNumber('TestMessage')).toBe(11);

      manager.assignFieldNumber('TestMessage', 'field2', 5);
      expect(manager.getNextFieldNumber('TestMessage')).toBe(12);
    });
  });

  describe('getFieldNumber', () => {
    test('should return undefined for unassigned field', () => {
      const manager = createFieldNumberManager();
      expect(manager.getFieldNumber('TestMessage', 'field1')).toBeUndefined();
    });

    test('should return assigned field number', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 42);
      expect(manager.getFieldNumber('TestMessage', 'field1')).toBe(42);
    });

    test('should return undefined for non-existent message', () => {
      const manager = createFieldNumberManager();
      expect(manager.getFieldNumber('NonExistent', 'field1')).toBeUndefined();
    });
  });

  describe('resetMessage', () => {
    test('should reset field numbers for a message', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 1);
      manager.assignFieldNumber('TestMessage', 'field2', 2);

      manager.resetMessage('TestMessage');

      expect(manager.getFieldNumber('TestMessage', 'field1')).toBeUndefined();
      expect(manager.getFieldNumber('TestMessage', 'field2')).toBeUndefined();
      expect(manager.getNextFieldNumber('TestMessage')).toBe(1);
    });

    test('should not affect other messages', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('Message1', 'field1', 1);
      manager.assignFieldNumber('Message2', 'field1', 1);

      manager.resetMessage('Message1');

      expect(manager.getFieldNumber('Message1', 'field1')).toBeUndefined();
      expect(manager.getFieldNumber('Message2', 'field1')).toBe(1);
    });
  });

  describe('resetAll', () => {
    test('should reset all field numbers', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('Message1', 'field1', 1);
      manager.assignFieldNumber('Message2', 'field1', 1);

      manager.resetAll();

      expect(manager.getFieldNumber('Message1', 'field1')).toBeUndefined();
      expect(manager.getFieldNumber('Message2', 'field1')).toBeUndefined();
      expect(manager.getNextFieldNumber('Message1')).toBe(1);
      expect(manager.getNextFieldNumber('Message2')).toBe(1);
    });
  });

  describe('getMessageFields', () => {
    test('should return empty object for message with no fields', () => {
      const manager = createFieldNumberManager();
      expect(manager.getMessageFields('TestMessage')).toEqual({});
    });

    test('should return all fields for a message', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 1);
      manager.assignFieldNumber('TestMessage', 'field2', 2);
      manager.assignFieldNumber('TestMessage', 'field3', 3);

      expect(manager.getMessageFields('TestMessage')).toEqual({
        field1: 1,
        field2: 2,
        field3: 3,
      });
    });

    test('should not return fields from other messages', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('Message1', 'field1', 1);
      manager.assignFieldNumber('Message2', 'field2', 2);

      const fields = manager.getMessageFields('Message1');
      expect(fields).toEqual({ field1: 1 });
      expect(fields).not.toHaveProperty('field2');
    });
  });

  describe('integration scenarios', () => {
    test('should handle mixed assignment and next number calls', () => {
      const manager = createFieldNumberManager();

      // Mix manual assignments with auto-incrementing
      const num1 = manager.getNextFieldNumber('TestMessage');
      manager.assignFieldNumber('TestMessage', 'field1', num1);

      const num2 = manager.getNextFieldNumber('TestMessage');
      manager.assignFieldNumber('TestMessage', 'field2', num2);

      const num3 = manager.getNextFieldNumber('TestMessage');
      manager.assignFieldNumber('TestMessage', 'field3', num3);

      expect(manager.getMessageFields('TestMessage')).toEqual({
        field1: 1,
        field2: 2,
        field3: 3,
      });
    });

    test('should handle field reassignment', () => {
      const manager = createFieldNumberManager();

      manager.assignFieldNumber('TestMessage', 'field1', 1);
      expect(manager.getFieldNumber('TestMessage', 'field1')).toBe(1);

      // Reassign the same field
      manager.assignFieldNumber('TestMessage', 'field1', 10);
      expect(manager.getFieldNumber('TestMessage', 'field1')).toBe(10);
    });

    test('should handle multiple messages simultaneously', () => {
      const manager = createFieldNumberManager();

      // Build several messages at once
      for (let i = 0; i < 3; i++) {
        const num1 = manager.getNextFieldNumber(`Message${i}`);
        manager.assignFieldNumber(`Message${i}`, 'id', num1);

        const num2 = manager.getNextFieldNumber(`Message${i}`);
        manager.assignFieldNumber(`Message${i}`, 'name', num2);
      }

      // Verify each message has independent numbering
      for (let i = 0; i < 3; i++) {
        expect(manager.getMessageFields(`Message${i}`)).toEqual({
          id: 1,
          name: 2,
        });
      }
    });
  });
});
