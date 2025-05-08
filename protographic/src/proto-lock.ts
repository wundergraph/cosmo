/**
 * Interface for Proto Lock file structure
 */
export interface ProtoLock {
  version: string;
  messages: Record<string, MessageLock>;
  services: Record<string, ServiceLock>;
  enums: Record<string, EnumLock>;
  arguments: Record<string, ArgumentLock>;
}

interface MessageLock {
  fields: string[]; // Field names in order
}

interface ServiceLock {
  methods: string[]; // Method names in order
}

interface EnumLock {
  values: string[]; // Enum value names in order
}

interface ArgumentLock {
  args: string[]; // Argument names in order
}

/**
 * Class to manage proto lock data for deterministic field ordering
 */
export class ProtoLockManager {
  private lockData: ProtoLock;

  /**
   * Create a new ProtoLockManager
   *
   * @param initialLockData - Initial lock data to use, if any
   */
  constructor(initialLockData?: ProtoLock) {
    this.lockData = initialLockData || {
      version: '1.0.0',
      messages: {},
      services: {},
      enums: {},
      arguments: {},
    };
  }

  /**
   * Reconcile and get the ordered field names for a message
   *
   * @param messageName - Name of the message
   * @param availableFields - Available field names (used when no lock exists)
   * @returns Ordered array of field names
   */
  public reconcileMessageFieldOrder(messageName: string, availableFields: string[]): string[] {
    if (!this.lockData.messages[messageName]) {
      this.lockData.messages[messageName] = { fields: [...availableFields] };
      return availableFields;
    }

    // Combine fields from lock and available fields, prioritizing lock order
    const lockedFields = this.lockData.messages[messageName].fields;
    const result: string[] = [];

    // Only include fields from the lock that are still available
    for (const field of lockedFields) {
      if (availableFields.includes(field)) {
        result.push(field);
      }
    }

    // Add any new fields not in the lock
    for (const field of availableFields) {
      if (!result.includes(field)) {
        result.push(field);
      }
    }

    // No need to update the lock data when fields are removed
    // This keeps the original ordering for backward compatibility
    // if fields are re-added later

    // Only update lock if new fields were added
    if (availableFields.length > lockedFields.length) {
      // Add new fields to the lock
      for (const field of availableFields) {
        if (!lockedFields.includes(field)) {
          lockedFields.push(field);
        }
      }
    }

    return result;
  }

  /**
   * Reconcile and get the ordered method names for a service
   *
   * @param serviceName - Name of the service
   * @param availableMethods - Available method names (used when no lock exists)
   * @returns Ordered array of method names
   */
  public reconcileServiceMethodOrder(serviceName: string, availableMethods: string[]): string[] {
    if (!this.lockData.services[serviceName]) {
      this.lockData.services[serviceName] = { methods: [...availableMethods] };
      return availableMethods;
    }

    // Combine methods from lock and available methods, prioritizing lock order
    const lockedMethods = this.lockData.services[serviceName].methods;
    const result: string[] = [];

    // Only include methods from the lock that are still available
    for (const method of lockedMethods) {
      if (availableMethods.includes(method)) {
        result.push(method);
      }
    }

    // Add any new methods not in the lock
    for (const method of availableMethods) {
      if (!result.includes(method)) {
        result.push(method);
      }
    }

    // Only update lock if new methods were added
    if (availableMethods.length > lockedMethods.length) {
      // Add new methods to the lock
      for (const method of availableMethods) {
        if (!lockedMethods.includes(method)) {
          lockedMethods.push(method);
        }
      }
    }

    return result;
  }

  /**
   * Reconcile and get the ordered enum values
   *
   * @param enumName - Name of the enum
   * @param availableValues - Available enum values (used when no lock exists)
   * @returns Ordered array of enum values
   */
  public reconcileEnumValueOrder(enumName: string, availableValues: string[]): string[] {
    if (!this.lockData.enums[enumName]) {
      this.lockData.enums[enumName] = { values: [...availableValues] };
      return availableValues;
    }

    // Combine values from lock and available values, prioritizing lock order
    const lockedValues = this.lockData.enums[enumName].values;
    const result: string[] = [];

    // Only include values from the lock that are still available
    for (const value of lockedValues) {
      if (availableValues.includes(value)) {
        result.push(value);
      }
    }

    // Add any new values not in the lock
    for (const value of availableValues) {
      if (!result.includes(value)) {
        result.push(value);
      }
    }

    // Only update lock if new values were added
    if (availableValues.length > lockedValues.length) {
      // Add new values to the lock
      for (const value of availableValues) {
        if (!lockedValues.includes(value)) {
          lockedValues.push(value);
        }
      }
    }

    return result;
  }

  /**
   * Reconcile and get the ordered argument names for a field
   *
   * @param fieldPath - Path to the field in the format "TypeName.fieldName"
   * @param availableArgs - Available argument names (used when no lock exists)
   * @returns Ordered array of argument names
   */
  public reconcileArgumentOrder(fieldPath: string, availableArgs: string[]): string[] {
    if (!this.lockData.arguments[fieldPath]) {
      this.lockData.arguments[fieldPath] = { args: [...availableArgs] };
      return availableArgs;
    }

    // Combine args from lock and available args, prioritizing lock order
    const lockedArgs = this.lockData.arguments[fieldPath].args;
    const result: string[] = [];

    // Only include args from the lock that are still available
    for (const arg of lockedArgs) {
      if (availableArgs.includes(arg)) {
        result.push(arg);
      }
    }

    // Add any new args not in the lock
    for (const arg of availableArgs) {
      if (!result.includes(arg)) {
        result.push(arg);
      }
    }

    // Only update lock if new args were added
    if (availableArgs.length > lockedArgs.length) {
      // Add new args to the lock
      for (const arg of availableArgs) {
        if (!lockedArgs.includes(arg)) {
          lockedArgs.push(arg);
        }
      }
    }

    return result;
  }

  /**
   * Get the current lock data
   */
  public getLockData(): ProtoLock {
    return this.lockData;
  }
}
