/**
 * Interface for Proto Lock file structure
 */
export interface ProtoLock {
  version: string;
  messages: Record<string, MessageLock>;
  enums: Record<string, EnumLock>;
}

interface MessageLock {
  fields: Record<string, number>; // Maps field name to field number
  reservedNumbers?: number[]; // Field numbers that have been removed and should be reserved
}

interface EnumLock {
  fields: Record<string, number>; // Maps enum value to number
  reservedNumbers?: number[]; // Enum value numbers that have been removed and should be reserved
}

/**
 * Class to manage proto lock data for deterministic field ordering
 */
export class ProtoLockManager {
  private readonly lockData: ProtoLock;

  /**
   * Create a new ProtoLockManager
   *
   * @param initialLockData - Initial lock data to use, if any
   */
  constructor(initialLockData?: ProtoLock) {
    this.lockData = initialLockData || {
      version: '1.0.0',
      messages: {},
      enums: {},
    };
  }

  /**
   * Generic method to reconcile items and their numbers
   *
   * @param container - The container object (messages or enums)
   * @param itemName - Name of the item (message or enum)
   * @param availableItems - Available item names (fields or enum values)
   * @returns Ordered array of item names
   */
  private reconcileItems<T extends MessageLock | EnumLock>(
    container: Record<string, T>,
    itemName: string,
    availableItems: string[],
  ): string[] {
    // Ensure container item exists
    if (!container[itemName]) {
      container[itemName] = { fields: {} } as T;
    }

    // Get existing fields map
    const fieldsMap = container[itemName].fields;

    // Get existing reserved numbers
    let reservedNumbers: number[] = container[itemName].reservedNumbers || [];

    // Track removed items and their numbers
    const removedItems: Record<string, number> = {};

    // Identify removed items
    Object.entries(fieldsMap).forEach(([item, number]) => {
      if (!availableItems.includes(item)) {
        reservedNumbers.push(number);
        removedItems[item] = number;
      }
    });

    // Deduplicate reserved numbers
    reservedNumbers = [...new Set(reservedNumbers)];

    // Create new fields map
    const newFieldsMap: Record<string, number> = {};

    // Preserve existing numbers for items that are still available
    availableItems.forEach((item) => {
      const existingNumber = fieldsMap[item];
      if (existingNumber !== undefined) {
        newFieldsMap[item] = existingNumber;

        // Remove from reserved if it's reused
        const index = reservedNumbers.indexOf(existingNumber);
        if (index !== -1) {
          reservedNumbers.splice(index, 1);
        }
      }
    });

    // Get highest assigned number
    let maxNumber = 0;
    Object.values(newFieldsMap).forEach((num) => {
      maxNumber = Math.max(maxNumber, num);
    });

    // Also consider reserved numbers for max
    if (reservedNumbers.length > 0) {
      maxNumber = Math.max(maxNumber, ...reservedNumbers);
    }

    // Assign numbers to items that don't have one
    availableItems.forEach((item) => {
      if (newFieldsMap[item] === undefined) {
        // Check if the item was previously removed (exists in our reservedNumbers)
        let reservedNumber: number | undefined;
        Object.entries(removedItems).forEach(([removedItem, number]) => {
          if (removedItem === item && reservedNumbers.includes(number)) {
            reservedNumber = number;
          }
        });

        if (reservedNumber !== undefined) {
          // Reuse the reserved number for this item
          newFieldsMap[item] = reservedNumber;

          // Remove from reserved list
          const index = reservedNumbers.indexOf(reservedNumber);
          if (index !== -1) {
            reservedNumbers.splice(index, 1);
          }
        } else {
          // Find next available number
          let nextNumber = maxNumber + 1;
          while (reservedNumbers.includes(nextNumber)) {
            nextNumber++;
          }

          newFieldsMap[item] = nextNumber;
          maxNumber = nextNumber;
        }
      }
    });

    // Update the fields map and reserved numbers
    container[itemName].fields = newFieldsMap;
    if (reservedNumbers.length > 0) {
      container[itemName].reservedNumbers = reservedNumbers;
    } else {
      // If no reserved numbers, make sure the property doesn't exist
      delete container[itemName].reservedNumbers;
    }

    // Sort available items by their assigned numbers
    return [...availableItems].sort((a, b) => {
      return newFieldsMap[a] - newFieldsMap[b];
    });
  }

  /**
   * Reconcile and get the ordered field names for a message
   *
   * @param messageName - Name of the message
   * @param availableFields - Available field names (used when no lock exists)
   * @returns Ordered array of field names
   */
  public reconcileMessageFieldOrder(messageName: string, availableFields: string[]): string[] {
    return this.reconcileItems(this.lockData.messages, messageName, availableFields);
  }

  /**
   * Reconcile and get the ordered enum values
   *
   * @param enumName - Name of the enum
   * @param availableValues - Available enum values (used when no lock exists)
   * @returns Ordered array of enum values
   */
  public reconcileEnumValueOrder(enumName: string, availableValues: string[]): string[] {
    return this.reconcileItems(this.lockData.enums, enumName, availableValues);
  }

  /**
   * Reconcile and get the ordered argument names for a field
   *
   * @param fieldPath - Path to the field in the format "TypeName.fieldName"
   * @param availableArgs - Available argument names (used when no lock exists)
   * @returns Ordered array of argument names
   */
  public reconcileArgumentOrder(fieldPath: string, availableArgs: string[]): string[] {
    // Use the regular message field ordering for arguments
    return this.reconcileMessageFieldOrder(fieldPath, availableArgs);
  }

  /**
   * Get the current lock data
   */
  public getLockData(): ProtoLock {
    return this.lockData;
  }
}
