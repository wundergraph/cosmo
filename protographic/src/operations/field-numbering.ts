import { ProtoLockManager } from '../proto-lock.js';

/**
 * Field numbering manager for Protocol Buffer messages
 *
 * This module handles the assignment and tracking of field numbers
 * across multiple proto messages to ensure uniqueness within each message.
 * Integrates with ProtoLockManager for field number stability across compilations.
 */

/**
 * Manages field number assignment for a collection of messages
 */
export interface FieldNumberManager {
  /**
   * Gets the next available field number for a given message
   * @param messageName - The name of the message
   * @returns The next available field number
   */
  getNextFieldNumber(messageName: string): number;

  /**
   * Assigns a specific field number to a field in a message
   * @param messageName - The name of the message
   * @param fieldName - The name of the field
   * @param fieldNumber - The field number to assign
   */
  assignFieldNumber(messageName: string, fieldName: string, fieldNumber: number): void;

  /**
   * Gets the field number for a specific field if it exists
   * @param messageName - The name of the message
   * @param fieldName - The name of the field
   * @returns The field number or undefined if not assigned
   */
  getFieldNumber(messageName: string, fieldName: string): number | undefined;

  /**
   * Resets field numbering for a specific message
   * @param messageName - The name of the message to reset
   */
  resetMessage(messageName: string): void;

  /**
   * Resets all field numbering
   */
  resetAll(): void;

  /**
   * Gets all field mappings for a message
   * @param messageName - The name of the message
   * @returns Record of field names to field numbers
   */
  getMessageFields(messageName: string): Record<string, number>;

  /**
   * Reconciles field order for a message using lock data
   * @param messageName - The name of the message
   * @param fieldNames - The field names to reconcile
   * @returns Ordered array of field names
   */
  reconcileFieldOrder(messageName: string, fieldNames: string[]): string[];

  /**
   * Gets the lock manager if available
   */
  getLockManager(): ProtoLockManager | undefined;
}

/**
 * Create a FieldNumberManager that tracks and assigns protobuf field numbers for messages.
 *
 * @param lockManager - Optional ProtoLockManager used to reconcile and preserve field numbers and ordering from lock data
 * @returns A FieldNumberManager instance for assigning, retrieving, resetting, and reconciling per-message field numbers
 */
export function createFieldNumberManager(lockManager?: ProtoLockManager): FieldNumberManager {
  // Map of message name to field name to field number
  const fieldNumbers = new Map<string, Map<string, number>>();

  // Map of message name to the next available field number
  const nextFieldNumbers = new Map<string, number>();

  return {
    getNextFieldNumber(messageName: string): number {
      // If we have a lock manager and this message has been reconciled,
      // check if we already have a field number assigned
      if (lockManager) {
        const lockData = lockManager.getLockData();
        const messageData = lockData.messages[messageName];

        if (messageData) {
          // Find the highest assigned number
          const assignedNumbers = Object.values(messageData.fields);
          const reservedNumbers = messageData.reservedNumbers || [];
          const allNumbers = [...assignedNumbers, ...reservedNumbers];

          if (allNumbers.length > 0) {
            const maxNumber = Math.max(...allNumbers);

            // Initialize next field number to be after the max
            if (!nextFieldNumbers.has(messageName)) {
              nextFieldNumbers.set(messageName, maxNumber + 1);
            }
          }
        }
      }

      // Initialize if needed
      if (!nextFieldNumbers.has(messageName)) {
        nextFieldNumbers.set(messageName, 1);
      }

      const current = nextFieldNumbers.get(messageName)!;
      nextFieldNumbers.set(messageName, current + 1);
      return current;
    },

    assignFieldNumber(messageName: string, fieldName: string, fieldNumber: number): void {
      // Initialize message map if needed
      if (!fieldNumbers.has(messageName)) {
        fieldNumbers.set(messageName, new Map());
      }

      const messageFields = fieldNumbers.get(messageName)!;
      messageFields.set(fieldName, fieldNumber);

      // Update next field number if this assignment affects it
      const currentNext = nextFieldNumbers.get(messageName) || 1;
      if (fieldNumber >= currentNext) {
        nextFieldNumbers.set(messageName, fieldNumber + 1);
      }
    },

    getFieldNumber(messageName: string, fieldName: string): number | undefined {
      return fieldNumbers.get(messageName)?.get(fieldName);
    },

    resetMessage(messageName: string): void {
      fieldNumbers.delete(messageName);
      nextFieldNumbers.set(messageName, 1);
    },

    resetAll(): void {
      fieldNumbers.clear();
      nextFieldNumbers.clear();
    },

    getMessageFields(messageName: string): Record<string, number> {
      const messageFields = fieldNumbers.get(messageName);
      if (!messageFields) {
        return {};
      }

      const result: Record<string, number> = {};
      for (const [fieldName, fieldNumber] of messageFields.entries()) {
        result[fieldName] = fieldNumber;
      }
      return result;
    },

    reconcileFieldOrder(messageName: string, fieldNames: string[]): string[] {
      if (!lockManager) {
        // No lock manager, return fields in original order
        return fieldNames;
      }

      // Use lock manager to reconcile field order
      const orderedFields = lockManager.reconcileMessageFieldOrder(messageName, fieldNames);

      // Update our internal tracking with the reconciled numbers
      const lockData = lockManager.getLockData();
      const messageData = lockData.messages[messageName];

      if (messageData) {
        // Initialize message map if needed
        if (!fieldNumbers.has(messageName)) {
          fieldNumbers.set(messageName, new Map());
        }

        const messageFields = fieldNumbers.get(messageName)!;

        // Update field numbers from lock data
        for (const fieldName of orderedFields) {
          const fieldNumber = messageData.fields[fieldName];
          if (fieldNumber !== undefined) {
            messageFields.set(fieldName, fieldNumber);

            // Update next field number
            const currentNext = nextFieldNumbers.get(messageName) || 1;
            if (fieldNumber >= currentNext) {
              nextFieldNumbers.set(messageName, fieldNumber + 1);
            }
          }
        }
      }

      return orderedFields;
    },

    getLockManager(): ProtoLockManager | undefined {
      return lockManager;
    },
  };
}
