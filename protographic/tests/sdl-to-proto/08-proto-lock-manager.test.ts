import { describe, expect, test } from 'vitest';
import { ProtoLockManager } from '../../src/proto-lock';

describe('ProtoLockManager', () => {
  test('should correctly initialize lock data with ordered fields', () => {
    const lockManager = new ProtoLockManager();

    // Reconcile fields for a message
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2']);

    // Expect fields to be ordered by assigned numbers
    expect(orderedFields).toEqual(['field1', 'field2']);

    // Get lock data
    const lockData = lockManager.getLockData();

    // Verify lock data structure
    expect(lockData.messages).toBeDefined();
    expect(lockData.messages.Test).toBeDefined();
    expect(lockData.messages.Test.fields).toBeDefined();

    // Verify field numbers
    expect(lockData.messages.Test.fields).toEqual({ field1: 1, field2: 2 });
  });

  test('should maintain existing field ordering from lock', () => {
    // Create lock manager with existing lock data
    const lockManager = new ProtoLockManager({
      version: '1.0.0',
      messages: {
        Test: { fields: { field2: 1, field1: 2 } }, // Reverse order
      },
      enums: {},
    });

    // Reconcile fields for a message
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2']);

    // Expect fields to be ordered by existing numbers in lock
    expect(orderedFields).toEqual(['field2', 'field1']);
  });

  test('should add new fields after existing ones', () => {
    // Create lock manager with existing lock data
    const lockManager = new ProtoLockManager({
      version: '1.0.0',
      messages: {
        Test: { fields: { field1: 1, field2: 2 } },
      },
      enums: {},
    });

    // Reconcile fields with a new field
    const orderedFields = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field3', 'field2']);

    // Expect new field to be added with next available number
    expect(orderedFields).toEqual(['field1', 'field2', 'field3']);

    // Get lock data
    const lockData = lockManager.getLockData();

    // Verify new field is added to lock
    expect(lockData.messages.Test.fields).toEqual({ field1: 1, field2: 2, field3: 3 });
  });

  test('should track removed fields in reserved numbers', () => {
    // Create lock manager with existing lock data
    const lockManager = new ProtoLockManager({
      version: '1.0.0',
      messages: {
        Test: { fields: { field1: 1, field2: 2, field3: 3 } },
      },
      enums: {},
    });

    // Reconcile fields with field2 removed
    lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field3']);

    // Verify field2 is removed from fields
    expect(Object.keys(lockManager.getLockData().messages.Test.fields)).not.toContain('field2');

    // Verify remaining fields have same numbers
    expect(lockManager.getLockData().messages.Test.fields.field1).toBe(1);
    expect(lockManager.getLockData().messages.Test.fields.field3).toBe(3);

    // Verify field2's number is now in the reserved numbers list
    expect(lockManager.getLockData().messages.Test.reservedNumbers).toContain(2);
  });

  test('should handle argument ordering for fields', () => {
    const lockManager = new ProtoLockManager();

    // Define operation name and args
    const operationName = 'QueryGetUser';
    const args = ['id', 'includeDetails', 'limit'];

    // Reconcile argument order
    const orderedArgs = lockManager.reconcileArgumentOrder(operationName, args);

    // Expect arguments to be ordered by assigned numbers
    expect(orderedArgs).toEqual(args);

    // Get lock data
    const lockData = lockManager.getLockData();

    // Verify lock data has assigned sequential numbers to args
    expect(lockData.messages[operationName].fields).toEqual({
      id: 1,
      includeDetails: 2,
      limit: 3,
    });
  });

  test('should handle field re-addition after removal', () => {
    // Create lock manager with existing lock data
    const lockManager = new ProtoLockManager({
      version: '1.0.0',
      messages: {
        Test: { fields: { field1: 1, field2: 2, field3: 3 } },
      },
      enums: {},
    });

    // First reconcile with field2 removed
    lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field3']);

    // Get lock data after first reconcile
    const lockData = lockManager.getLockData();

    // Verify field2 is now reserved
    expect(lockData.messages.Test.reservedNumbers).toContain(2);

    // Verify fields only contains current fields
    expect(Object.keys(lockData.messages.Test.fields)).toHaveLength(2);
    expect(lockData.messages.Test.fields.field1).toBe(1);
    expect(lockData.messages.Test.fields.field3).toBe(3);

    // Now reconcile with field2 added back and a new field
    const result = lockManager.reconcileMessageFieldOrder('Test', ['field1', 'field2', 'field3', 'field4']);

    // Get updated lock data
    const updatedLockData = lockManager.getLockData();

    // When a field is re-added, it gets a new field number (4) rather than reusing the reserved number (2)
    // This behavior is intentional as it preserves backward compatibility in the proto format
    expect(updatedLockData.messages.Test.fields.field2).toBe(4);

    // Verify field4 gets the next available number
    expect(updatedLockData.messages.Test.fields.field4).toBe(5);

    // Verify field order is by number value
    expect(result).toEqual(['field1', 'field3', 'field2', 'field4']);
  });

  test('should handle complex field removal and re-addition', () => {
    // Create a lock manager with multiple fields
    const lockManager = new ProtoLockManager({
      version: '1.0.0',
      messages: {
        Message: {
          fields: { field1: 1, field2: 2, field3: 3, field4: 4 },
        },
      },
      enums: {},
    });

    // Remove some fields
    lockManager.reconcileMessageFieldOrder('Message', ['field1', 'field3']);

    // Get the lock data
    const lockData = lockManager.getLockData();

    // Verify only current fields remain
    expect(Object.keys(lockData.messages.Message.fields)).toHaveLength(2);

    // Remove another field and add a new one
    lockManager.reconcileMessageFieldOrder('Message', ['field1', 'field5']);

    // Verify only current fields are in fields
    expect(Object.keys(lockData.messages.Message.fields)).toHaveLength(2);
    expect(lockData.messages.Message.fields.field1).toBe(1);
    expect(lockData.messages.Message.fields.field5).toBe(5);

    // Reserved numbers should have all removed fields
    expect(lockData.messages.Message.reservedNumbers).toContain(2);
    expect(lockData.messages.Message.reservedNumbers).toContain(3);
    expect(lockData.messages.Message.reservedNumbers).toContain(4);
  });
});
