import { describe, expect, test } from 'vitest';
import { ProtoLock, ProtoLockManager } from '../../src/proto-lock';

describe('ProtoLock', () => {
  test('should manage ordering with in-memory data structure', () => {
    // Create a lock manager with no initial data
    const lockManager = new ProtoLockManager();

    // Add some fields to a message
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2']);

    // Verify initial field order
    expect(orderedFields).toEqual(['field1', 'field2']);

    // Get lock data
    const lockData = lockManager.getLockData();
    expect(lockData.messages.Test.fields).toEqual(['field1', 'field2']);

    // Create a new lock manager with the saved data
    const newLockManager = new ProtoLockManager(lockData);

    // Add a new field
    const updatedFields = newLockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2', 'field3']);

    // Verify field order is preserved and new field is added at the end
    expect(updatedFields).toEqual(['field1', 'field2', 'field3']);
  });

  test('should use existing order from lock data', () => {
    // Create initial lock data with a specific order
    const initialLock: ProtoLock = {
      version: '1.0.0',
      messages: {
        Test: { fields: ['field2', 'field1'] }, // Reverse order
      },
      services: {},
      arguments: {},
      enums: {},
    };

    // Create a lock manager with the initial data
    const lockManager = new ProtoLockManager(initialLock);
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2']);

    // Verify order matches the lock data, not the input order
    expect(orderedFields).toEqual(['field2', 'field1']);
  });

  test('should add new fields to the end', () => {
    // Create initial lock data
    const initialLock: ProtoLock = {
      version: '1.0.0',
      messages: {
        Test: { fields: ['field1', 'field2'] },
      },
      services: {},
      arguments: {},
      enums: {},
    };

    // Create a lock manager and add a new field
    const lockManager = new ProtoLockManager(initialLock);
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2', 'field3']);

    // Verify order has new field at the end
    expect(orderedFields).toEqual(['field1', 'field2', 'field3']);

    // Verify updated data
    const lockData = lockManager.getLockData();
    expect(lockData.messages.Test.fields).toEqual(['field1', 'field2', 'field3']);
  });

  test('should handle removed fields', () => {
    // Create initial lock data
    const initialLock: ProtoLock = {
      version: '1.0.0',
      messages: {
        Test: { fields: ['field1', 'field2', 'field3'] },
      },
      services: {},
      arguments: {},
      enums: {},
    };

    // Create a lock manager with a removed field
    const lockManager = new ProtoLockManager(initialLock);
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field3']);

    // Verify removed field is not in the result but order is preserved
    expect(orderedFields).toEqual(['field1', 'field3']);

    // Verify field2 is not in the result, but still in the lock data
    // because we keep the original lock data intact
    expect(orderedFields.includes('field2')).toBe(false);
    expect(lockManager.getLockData().messages.Test.fields).toContain('field2');
  });
});
