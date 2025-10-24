/**
 * Field numbering manager for Protocol Buffer messages
 * 
 * This module handles the assignment and tracking of field numbers
 * across multiple proto messages to ensure uniqueness within each message.
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
}

/**
 * Creates a new field number manager instance
 * 
 * @returns A new field number manager
 */
export function createFieldNumberManager(): FieldNumberManager {
  // Map of message name to field name to field number
  const fieldNumbers = new Map<string, Map<string, number>>();
  
  // Map of message name to the next available field number
  const nextFieldNumbers = new Map<string, number>();
  
  return {
    getNextFieldNumber(messageName: string): number {
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
  };
}

