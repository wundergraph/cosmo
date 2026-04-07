/**
 * Options for Protocol Buffer file generation
 */
export interface ProtoOptions {
  goPackage?: string;
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: boolean;
  csharpNamespace?: string;
  rubyPackage?: string;
  phpNamespace?: string;
  phpMetadataNamespace?: string;
  objcClassPrefix?: string;
  swiftPrefix?: string;
}

/**
 * Builds an array of proto option statements from the provided options
 *
 * @param options - The proto options to convert to statements
 * @param packageName - Optional package name for generating default go_package
 * @returns Array of proto option statements (e.g., 'option go_package = "...";')
 */
export function buildProtoOptions(options: ProtoOptions, packageName?: string): string[] {
  const optionStatements: string[] = [];

  if (options.goPackage && options.goPackage !== '') {
    // Generate default go_package if not provided
    const defaultGoPackage = packageName ? `cosmo/pkg/proto/${packageName};${packageName.replace('.', '')}` : undefined;
    const goPackageOption = options.goPackage || defaultGoPackage;
    optionStatements.push(`option go_package = "${goPackageOption}";`);
  }

  if (options.javaPackage) {
    optionStatements.push(`option java_package = "${options.javaPackage}";`);
  }

  if (options.javaOuterClassname) {
    optionStatements.push(`option java_outer_classname = "${options.javaOuterClassname}";`);
  }

  if (options.javaMultipleFiles) {
    optionStatements.push(`option java_multiple_files = true;`);
  }

  if (options.csharpNamespace) {
    optionStatements.push(`option csharp_namespace = "${options.csharpNamespace}";`);
  }

  if (options.rubyPackage) {
    optionStatements.push(`option ruby_package = "${options.rubyPackage}";`);
  }

  if (options.phpNamespace) {
    optionStatements.push(`option php_namespace = "${options.phpNamespace}";`);
  }

  if (options.phpMetadataNamespace) {
    optionStatements.push(`option php_metadata_namespace = "${options.phpMetadataNamespace}";`);
  }

  if (options.objcClassPrefix) {
    optionStatements.push(`option objc_class_prefix = "${options.objcClassPrefix}";`);
  }

  if (options.swiftPrefix) {
    optionStatements.push(`option swift_prefix = "${options.swiftPrefix}";`);
  }

  return optionStatements;
}
