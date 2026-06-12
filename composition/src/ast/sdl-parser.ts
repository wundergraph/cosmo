import { dedentBlockStringLines } from 'graphql/language/blockString';
import { type DocumentNode } from 'graphql';

const enum TokenKind {
  EOF,
  Name,
  Int,
  Float,
  String,
  Punctuator,
}

const enum Char {
  Bang = 33,
  Quote = 34,
  Hash = 35,
  Dollar = 36,
  Amp = 38,
  ParenL = 40,
  ParenR = 41,
  Minus = 45,
  Dot = 46,
  Colon = 58,
  Equals = 61,
  At = 64,
  BracketL = 91,
  Backslash = 92,
  BracketR = 93,
  BraceL = 123,
  Pipe = 124,
  BraceR = 125,
}

const enum Code {
  Zero = 48,
  Nine = 57,
  A = 65,
  E = 69,
  F = 70,
  Z = 90,
  Underscore = 95,
  a = 97,
  e = 101,
  f = 102,
  n = 110,
  r = 114,
  t = 116,
  u = 117,
  z = 122,
}

const DIRECTIVE_LOCATIONS = new Set([
  'QUERY',
  'MUTATION',
  'SUBSCRIPTION',
  'FIELD',
  'FRAGMENT_DEFINITION',
  'FRAGMENT_SPREAD',
  'INLINE_FRAGMENT',
  'SCHEMA',
  'SCALAR',
  'OBJECT',
  'FIELD_DEFINITION',
  'ARGUMENT_DEFINITION',
  'INTERFACE',
  'UNION',
  'ENUM',
  'ENUM_VALUE',
  'INPUT_OBJECT',
  'INPUT_FIELD_DEFINITION',
]);

export class SdlParserFallback extends Error {
  constructor() {
    super('SDL parser fallback');
  }
}

const FALLBACK = new SdlParserFallback();

export function parseSdl(source: string): DocumentNode {
  try {
    if (startsWithSelectionSet(source)) {
      throw FALLBACK;
    }
    try {
      return new SimpleSdlParser(source).parseDocument();
    } catch {
      // Fall through to the full SDL parser for less common but supported grammar.
    }
    const parser = new SdlParser(source);
    return parser.parseDocument();
  } catch {
    throw FALLBACK;
  }
}

function startsWithSelectionSet(source: string) {
  let position = 0;
  const length = source.length;
  while (position < length) {
    const code = source.charCodeAt(position);
    if (code === 9 || code === 10 || code === 13 || code === 32 || code === 44 || code === 0xfeff) {
      position++;
      continue;
    }
    if (code === Char.Hash) {
      position++;
      while (position < length) {
        const commentCode = source.charCodeAt(position);
        if (commentCode === 10 || commentCode === 13) {
          break;
        }
        position += commentCode >= 0xd800 && commentCode <= 0xdbff ? 2 : 1;
      }
      continue;
    }
    return code === Char.BraceL;
  }
  return false;
}

class SimpleSdlParser {
  private readonly source: string;
  private readonly length: number;
  private position = 0;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }

  parseDocument(): DocumentNode {
    const definitions = [];
    this.skipIgnored();
    while (this.position < this.length) {
      definitions.push(this.parseDefinition());
      this.skipIgnored();
    }
    if (definitions.length === 0) {
      this.fail();
    }
    return {
      kind: 'Document',
      definitions,
    } as DocumentNode;
  }

  private parseDefinition(): any {
    if (this.peekKeyword('type')) {
      return this.parseObjectTypeDefinition();
    }
    if (this.peekKeyword('interface')) {
      return this.parseInterfaceTypeDefinition();
    }
    if (this.peekKeyword('union')) {
      return this.parseUnionTypeDefinition();
    }
    if (this.peekKeyword('enum')) {
      return this.parseEnumTypeDefinition();
    }
    if (this.peekKeyword('input')) {
      return this.parseInputObjectTypeDefinition();
    }
    this.fail();
  }

  private parseObjectTypeDefinition(): any {
    this.expectKeyword('type');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseDirectives();
    const fields = this.parseFieldsDefinition();
    return {
      kind: 'ObjectTypeDefinition',
      description: undefined,
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseInterfaceTypeDefinition(): any {
    this.expectKeyword('interface');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseDirectives();
    const fields = this.parseFieldsDefinition();
    return {
      kind: 'InterfaceTypeDefinition',
      description: undefined,
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseUnionTypeDefinition(): any {
    this.expectKeyword('union');
    const name = this.parseName();
    const directives = this.parseDirectives();
    const types = this.parseUnionMemberTypes();
    return {
      kind: 'UnionTypeDefinition',
      description: undefined,
      name,
      directives,
      types,
    };
  }

  private parseEnumTypeDefinition(): any {
    this.expectKeyword('enum');
    const name = this.parseName();
    const directives = this.parseDirectives();
    const values = this.parseEnumValuesDefinition();
    return {
      kind: 'EnumTypeDefinition',
      description: undefined,
      name,
      directives,
      values,
    };
  }

  private parseInputObjectTypeDefinition(): any {
    this.expectKeyword('input');
    const name = this.parseName();
    const directives = this.parseDirectives();
    const fields = this.parseInputFieldsDefinition();
    return {
      kind: 'InputObjectTypeDefinition',
      description: undefined,
      name,
      directives,
      fields,
    };
  }

  private parseFieldsDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    this.skipIgnored();
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const fields = [];
    do {
      fields.push(this.parseFieldDefinition());
      this.skipIgnored();
    } while (!this.peekPunct(Char.BraceR));
    this.position++;
    return fields;
  }

  private parseFieldDefinition(): any {
    this.skipIgnored();
    const name = this.parseNameAfterIgnored();
    const args = this.parseArgumentDefs();
    this.skipIgnored();
    if (this.source.charCodeAt(this.position) !== Char.Colon) {
      this.fail();
    }
    this.position++;
    const type = this.parseType();
    const directives = this.parseDirectives();
    return {
      kind: 'FieldDefinition',
      description: undefined,
      name,
      arguments: args,
      type,
      directives,
    };
  }

  private parseArgumentDefs(): any[] {
    if (!this.eatPunct(Char.ParenL)) {
      return [];
    }
    this.skipIgnored();
    if (this.peekPunct(Char.ParenR)) {
      this.fail();
    }
    const args = [];
    do {
      args.push(this.parseInputValueDefinition());
      this.skipIgnored();
    } while (!this.peekPunct(Char.ParenR));
    this.position++;
    return args;
  }

  private parseInputFieldsDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    this.skipIgnored();
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const fields = [];
    do {
      fields.push(this.parseInputValueDefinition());
      this.skipIgnored();
    } while (!this.peekPunct(Char.BraceR));
    this.position++;
    return fields;
  }

  private parseInputValueDefinition(): any {
    this.skipIgnored();
    const name = this.parseNameAfterIgnored();
    this.skipIgnored();
    if (this.source.charCodeAt(this.position) !== Char.Colon) {
      this.fail();
    }
    this.position++;
    const type = this.parseType();
    if (this.peekPunct(Char.Equals)) {
      this.fail();
    }
    const directives = this.parseDirectives();
    return {
      kind: 'InputValueDefinition',
      description: undefined,
      name,
      type,
      defaultValue: undefined,
      directives,
    };
  }

  private parseEnumValuesDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    this.skipIgnored();
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const values = [];
    do {
      const name = this.parseName();
      if (name.value === 'true' || name.value === 'false' || name.value === 'null') {
        this.fail();
      }
      const directives = this.parseDirectives();
      values.push({
        kind: 'EnumValueDefinition',
        description: undefined,
        name,
        directives,
      });
      this.skipIgnored();
    } while (!this.peekPunct(Char.BraceR));
    this.position++;
    return values;
  }

  private parseImplementsInterfaces(): any[] {
    if (!this.eatKeyword('implements')) {
      return [];
    }
    const interfaces = [this.parseNamedType()];
    while (this.eatPunct(Char.Amp)) {
      interfaces.push(this.parseNamedType());
    }
    return interfaces;
  }

  private parseUnionMemberTypes(): any[] {
    if (!this.eatPunct(Char.Equals)) {
      return [];
    }
    const types = [this.parseNamedType()];
    while (this.eatPunct(Char.Pipe)) {
      types.push(this.parseNamedType());
    }
    return types;
  }

  private parseDirectives(): any[] {
    const directives = [];
    while (this.eatPunct(Char.At)) {
      const name = this.parseName();
      const args = this.parseDirectiveArguments();
      directives.push({
        kind: 'Directive',
        name,
        arguments: args,
      });
    }
    return directives;
  }

  private parseDirectiveArguments(): any[] {
    if (!this.eatPunct(Char.ParenL)) {
      return [];
    }
    this.skipIgnored();
    if (this.peekPunct(Char.ParenR)) {
      this.fail();
    }
    const args = [];
    do {
      const name = this.parseName();
      this.expectPunct(Char.Colon);
      const value = this.parseSimpleConstValue();
      args.push({
        kind: 'Argument',
        name,
        value,
      });
      this.skipIgnored();
    } while (!this.peekPunct(Char.ParenR));
    this.position++;
    return args;
  }

  private parseSimpleConstValue(): any {
    this.skipIgnored();
    if (this.peekPunct(Char.Quote)) {
      return this.parseSimpleStringValue();
    }
    const value = this.readNameValue();
    if (value === 'true') {
      return {
        kind: 'BooleanValue',
        value: true,
      };
    }
    if (value === 'false') {
      return {
        kind: 'BooleanValue',
        value: false,
      };
    }
    if (value === 'null') {
      return {
        kind: 'NullValue',
      };
    }
    return {
      kind: 'EnumValue',
      value,
    };
  }

  private parseSimpleStringValue(): any {
    this.expectPunct(Char.Quote);
    const start = this.position;
    while (this.position < this.length) {
      const code = this.source.charCodeAt(this.position);
      if (code === Char.Quote) {
        const value = this.source.slice(start, this.position);
        this.position++;
        return {
          kind: 'StringValue',
          value,
          block: false,
        };
      }
      if (code === Char.Backslash || code === 10 || code === 13 || !isValidSourceCharacter(this.source, this.position)) {
        this.fail();
      }
      this.position += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    }
    this.fail();
  }

  private parseType(): any {
    this.skipIgnored();
    if (this.source.charCodeAt(this.position) === Char.BracketL) {
      this.fail();
    }
    let type: any = {
      kind: 'NamedType',
      name: this.parseNameAfterIgnored(),
    };
    this.skipIgnored();
    if (this.source.charCodeAt(this.position) === Char.Bang) {
      this.position++;
      type = {
        kind: 'NonNullType',
        type,
      };
    }
    return type;
  }

  private parseNamedType(): any {
    return {
      kind: 'NamedType',
      name: this.parseName(),
    };
  }

  private parseName(): any {
    this.skipIgnored();
    return this.parseNameAfterIgnored();
  }

  private parseNameAfterIgnored(): any {
    return {
      kind: 'Name',
      value: this.readNameValueAfterIgnored(),
    };
  }

  private readNameValue(): string {
    this.skipIgnored();
    return this.readNameValueAfterIgnored();
  }

  private readNameValueAfterIgnored(): string {
    const start = this.position;
    if (!isNameStart(this.source.charCodeAt(start))) {
      this.fail();
    }
    this.position++;
    while (this.position < this.length && isNameContinue(this.source.charCodeAt(this.position))) {
      this.position++;
    }
    return this.source.slice(start, this.position);
  }

  private peekKeyword(keyword: string) {
    this.skipIgnored();
    return this.source.startsWith(keyword, this.position) && !isNameContinue(this.source.charCodeAt(this.position + keyword.length));
  }

  private eatKeyword(keyword: string) {
    if (!this.peekKeyword(keyword)) {
      return false;
    }
    this.position += keyword.length;
    return true;
  }

  private expectKeyword(keyword: string) {
    if (!this.eatKeyword(keyword)) {
      this.fail();
    }
  }

  private peekPunct(code: number) {
    this.skipIgnored();
    return this.source.charCodeAt(this.position) === code;
  }

  private eatPunct(code: number) {
    if (!this.peekPunct(code)) {
      return false;
    }
    this.position++;
    return true;
  }

  private expectPunct(code: number) {
    if (!this.eatPunct(code)) {
      this.fail();
    }
  }

  private skipIgnored() {
    while (this.position < this.length) {
      const code = this.source.charCodeAt(this.position);
      if (code === 9 || code === 10 || code === 13 || code === 32 || code === 44 || code === 0xfeff) {
        this.position++;
        continue;
      }
      if (code === Char.Hash) {
        this.fail();
      }
      break;
    }
  }

  private fail(): never {
    throw new SdlParserFallback();
  }
}

class SdlParser {
  private readonly source: string;
  private readonly length: number;
  private position = 0;
  private tokenKind = TokenKind.EOF;
  private tokenCode = 0;
  private tokenValue = '';
  private tokenBlock = false;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }

  parseDocument(): DocumentNode {
    this.advance();
    if (this.peekPunct(Char.BraceL)) {
      this.fail();
    }

    const definitions = [];
    while (this.tokenKind !== TokenKind.EOF) {
      definitions.push(this.parseDefinition());
    }
    if (definitions.length === 0) {
      this.fail();
    }
    return {
      kind: 'Document',
      definitions,
    } as DocumentNode;
  }

  private parseDefinition(): any {
    const description = this.parseDescription();
    if (description !== undefined && this.peekName('extend')) {
      this.fail();
    }
    if (this.tokenKind !== TokenKind.Name) {
      this.fail();
    }

    switch (this.tokenValue) {
      case 'schema':
        return this.parseSchemaDefinition(description);
      case 'scalar':
        return this.parseScalarTypeDefinition(description);
      case 'type':
        return this.parseObjectTypeDefinition(description);
      case 'interface':
        return this.parseInterfaceTypeDefinition(description);
      case 'union':
        return this.parseUnionTypeDefinition(description);
      case 'enum':
        return this.parseEnumTypeDefinition(description);
      case 'input':
        return this.parseInputObjectTypeDefinition(description);
      case 'directive':
        return this.parseDirectiveDefinition(description);
      case 'extend':
        if (description !== undefined) {
          this.fail();
        }
        return this.parseTypeSystemExtension();
      case 'query':
      case 'mutation':
      case 'subscription':
      case 'fragment':
        this.fail();
    }
    this.fail();
  }

  private parseSchemaDefinition(description: any): any {
    this.expectKeyword('schema');
    const directives = this.parseConstDirectives();
    const operationTypes = this.parseOperationTypesDefinition();
    return {
      kind: 'SchemaDefinition',
      description,
      directives,
      operationTypes,
    };
  }

  private parseSchemaExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('schema');
    const directives = this.parseConstDirectives();
    const operationTypes = this.peekPunct(Char.BraceL) ? this.parseOperationTypesDefinition() : [];
    if (directives.length === 0 && operationTypes.length === 0) {
      this.fail();
    }
    return {
      kind: 'SchemaExtension',
      directives,
      operationTypes,
    };
  }

  private parseOperationTypesDefinition(): any[] {
    this.expectPunct(Char.BraceL);
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const operationTypes = [];
    do {
      operationTypes.push(this.parseOperationTypeDefinition());
    } while (!this.peekPunct(Char.BraceR));
    this.expectPunct(Char.BraceR);
    return operationTypes;
  }

  private parseOperationTypeDefinition(): any {
    const operation = this.parseOperationType();
    this.expectPunct(Char.Colon);
    const type = this.parseNamedType();
    return {
      kind: 'OperationTypeDefinition',
      operation,
      type,
    };
  }

  private parseOperationType(): string {
    if (this.eatName('query')) {
      return 'query';
    }
    if (this.eatName('mutation')) {
      return 'mutation';
    }
    if (this.eatName('subscription')) {
      return 'subscription';
    }
    this.fail();
  }

  private parseScalarTypeDefinition(description: any): any {
    this.expectKeyword('scalar');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    return {
      kind: 'ScalarTypeDefinition',
      description,
      name,
      directives,
    };
  }

  private parseScalarTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('scalar');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    if (directives.length === 0) {
      this.fail();
    }
    return {
      kind: 'ScalarTypeExtension',
      name,
      directives,
    };
  }

  private parseObjectTypeDefinition(description: any): any {
    this.expectKeyword('type');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    return {
      kind: 'ObjectTypeDefinition',
      description,
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseObjectTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('type');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
      this.fail();
    }
    return {
      kind: 'ObjectTypeExtension',
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseInterfaceTypeDefinition(description: any): any {
    this.expectKeyword('interface');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    return {
      kind: 'InterfaceTypeDefinition',
      description,
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseInterfaceTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('interface');
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
      this.fail();
    }
    return {
      kind: 'InterfaceTypeExtension',
      name,
      interfaces,
      directives,
      fields,
    };
  }

  private parseUnionTypeDefinition(description: any): any {
    this.expectKeyword('union');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const types = this.parseUnionMemberTypes();
    return {
      kind: 'UnionTypeDefinition',
      description,
      name,
      directives,
      types,
    };
  }

  private parseUnionTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('union');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const types = this.parseUnionMemberTypes();
    if (directives.length === 0 && types.length === 0) {
      this.fail();
    }
    return {
      kind: 'UnionTypeExtension',
      name,
      directives,
      types,
    };
  }

  private parseEnumTypeDefinition(description: any): any {
    this.expectKeyword('enum');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const values = this.parseEnumValuesDefinition();
    return {
      kind: 'EnumTypeDefinition',
      description,
      name,
      directives,
      values,
    };
  }

  private parseEnumTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('enum');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const values = this.parseEnumValuesDefinition();
    if (directives.length === 0 && values.length === 0) {
      this.fail();
    }
    return {
      kind: 'EnumTypeExtension',
      name,
      directives,
      values,
    };
  }

  private parseInputObjectTypeDefinition(description: any): any {
    this.expectKeyword('input');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const fields = this.parseInputFieldsDefinition();
    return {
      kind: 'InputObjectTypeDefinition',
      description,
      name,
      directives,
      fields,
    };
  }

  private parseInputObjectTypeExtension(): any {
    this.expectKeyword('extend');
    this.expectKeyword('input');
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const fields = this.parseInputFieldsDefinition();
    if (directives.length === 0 && fields.length === 0) {
      this.fail();
    }
    return {
      kind: 'InputObjectTypeExtension',
      name,
      directives,
      fields,
    };
  }

  private parseDirectiveDefinition(description: any): any {
    this.expectKeyword('directive');
    this.expectPunct(Char.At);
    const name = this.parseName();
    const args = this.parseArgumentDefs();
    const repeatable = this.eatName('repeatable');
    this.expectKeyword('on');
    const locations = this.parseDirectiveLocations();
    return {
      kind: 'DirectiveDefinition',
      description,
      name,
      arguments: args,
      repeatable,
      locations,
    };
  }

  private parseTypeSystemExtension(): any {
    if (!this.peekName('extend')) {
      this.fail();
    }
    const saved = this.position;
    const savedKind = this.tokenKind;
    const savedCode = this.tokenCode;
    const savedValue = this.tokenValue;
    const savedBlock = this.tokenBlock;

    this.advance();
    if (this.tokenKind !== TokenKind.Name) {
      this.fail();
    }
    const keyword = this.tokenValue;
    this.position = saved;
    this.tokenKind = savedKind;
    this.tokenCode = savedCode;
    this.tokenValue = savedValue;
    this.tokenBlock = savedBlock;

    switch (keyword) {
      case 'schema':
        return this.parseSchemaExtension();
      case 'scalar':
        return this.parseScalarTypeExtension();
      case 'type':
        return this.parseObjectTypeExtension();
      case 'interface':
        return this.parseInterfaceTypeExtension();
      case 'union':
        return this.parseUnionTypeExtension();
      case 'enum':
        return this.parseEnumTypeExtension();
      case 'input':
        return this.parseInputObjectTypeExtension();
    }
    this.fail();
  }

  private parseFieldsDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const fields = [];
    do {
      fields.push(this.parseFieldDefinition());
    } while (!this.peekPunct(Char.BraceR));
    this.expectPunct(Char.BraceR);
    return fields;
  }

  private parseFieldDefinition(): any {
    const description = this.parseDescription();
    const name = this.parseName();
    const args = this.parseArgumentDefs();
    this.expectPunct(Char.Colon);
    const type = this.parseType();
    const directives = this.parseConstDirectives();
    return {
      kind: 'FieldDefinition',
      description,
      name,
      arguments: args,
      type,
      directives,
    };
  }

  private parseArgumentDefs(): any[] {
    if (!this.eatPunct(Char.ParenL)) {
      return [];
    }
    if (this.peekPunct(Char.ParenR)) {
      this.fail();
    }
    const args = [];
    do {
      args.push(this.parseInputValueDefinition());
    } while (!this.peekPunct(Char.ParenR));
    this.expectPunct(Char.ParenR);
    return args;
  }

  private parseInputFieldsDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const fields = [];
    do {
      fields.push(this.parseInputValueDefinition());
    } while (!this.peekPunct(Char.BraceR));
    this.expectPunct(Char.BraceR);
    return fields;
  }

  private parseInputValueDefinition(): any {
    const description = this.parseDescription();
    const name = this.parseName();
    this.expectPunct(Char.Colon);
    const type = this.parseType();
    const defaultValue = this.eatPunct(Char.Equals) ? this.parseConstValueLiteral() : undefined;
    const directives = this.parseConstDirectives();
    return {
      kind: 'InputValueDefinition',
      description,
      name,
      type,
      defaultValue,
      directives,
    };
  }

  private parseEnumValuesDefinition(): any[] {
    if (!this.eatPunct(Char.BraceL)) {
      return [];
    }
    if (this.peekPunct(Char.BraceR)) {
      this.fail();
    }
    const values = [];
    do {
      values.push(this.parseEnumValueDefinition());
    } while (!this.peekPunct(Char.BraceR));
    this.expectPunct(Char.BraceR);
    return values;
  }

  private parseEnumValueDefinition(): any {
    const description = this.parseDescription();
    const name = this.parseName();
    if (name.value === 'true' || name.value === 'false' || name.value === 'null') {
      this.fail();
    }
    const directives = this.parseConstDirectives();
    return {
      kind: 'EnumValueDefinition',
      description,
      name,
      directives,
    };
  }

  private parseImplementsInterfaces(): any[] {
    if (!this.eatName('implements')) {
      return [];
    }
    this.eatPunct(Char.Amp);
    const interfaces = [this.parseNamedType()];
    while (this.eatPunct(Char.Amp)) {
      interfaces.push(this.parseNamedType());
    }
    return interfaces;
  }

  private parseUnionMemberTypes(): any[] {
    if (!this.eatPunct(Char.Equals)) {
      return [];
    }
    this.eatPunct(Char.Pipe);
    const types = [this.parseNamedType()];
    while (this.eatPunct(Char.Pipe)) {
      types.push(this.parseNamedType());
    }
    return types;
  }

  private parseDirectiveLocations(): any[] {
    this.eatPunct(Char.Pipe);
    const locations = [this.parseDirectiveLocation()];
    while (this.eatPunct(Char.Pipe)) {
      locations.push(this.parseDirectiveLocation());
    }
    return locations;
  }

  private parseDirectiveLocation(): any {
    const name = this.parseName();
    if (!DIRECTIVE_LOCATIONS.has(name.value)) {
      this.fail();
    }
    return name;
  }

  private parseConstDirectives(): any[] {
    const directives = [];
    while (this.eatPunct(Char.At)) {
      const name = this.parseName();
      const args = this.parseConstArguments();
      directives.push({
        kind: 'Directive',
        name,
        arguments: args,
      });
    }
    return directives;
  }

  private parseConstArguments(): any[] {
    if (!this.eatPunct(Char.ParenL)) {
      return [];
    }
    if (this.peekPunct(Char.ParenR)) {
      this.fail();
    }
    const args = [];
    do {
      const name = this.parseName();
      this.expectPunct(Char.Colon);
      const value = this.parseConstValueLiteral();
      args.push({
        kind: 'Argument',
        name,
        value,
      });
    } while (!this.peekPunct(Char.ParenR));
    this.expectPunct(Char.ParenR);
    return args;
  }

  private parseConstValueLiteral(): any {
    switch (this.tokenKind) {
      case TokenKind.Int: {
        const value = this.tokenValue;
        this.advance();
        return {
          kind: 'IntValue',
          value,
        };
      }
      case TokenKind.Float: {
        const value = this.tokenValue;
        this.advance();
        return {
          kind: 'FloatValue',
          value,
        };
      }
      case TokenKind.String:
        return this.parseStringValue();
      case TokenKind.Name: {
        const value = this.tokenValue;
        this.advance();
        if (value === 'true') {
          return {
            kind: 'BooleanValue',
            value: true,
          };
        }
        if (value === 'false') {
          return {
            kind: 'BooleanValue',
            value: false,
          };
        }
        if (value === 'null') {
          return {
            kind: 'NullValue',
          };
        }
        return {
          kind: 'EnumValue',
          value,
        };
      }
    }
    if (this.eatPunct(Char.BracketL)) {
      const values = [];
      while (!this.peekPunct(Char.BracketR)) {
        values.push(this.parseConstValueLiteral());
      }
      this.expectPunct(Char.BracketR);
      return {
        kind: 'ListValue',
        values,
      };
    }
    if (this.eatPunct(Char.BraceL)) {
      const fields = [];
      while (!this.peekPunct(Char.BraceR)) {
        const name = this.parseName();
        this.expectPunct(Char.Colon);
        const value = this.parseConstValueLiteral();
        fields.push({
          kind: 'ObjectField',
          name,
          value,
        });
      }
      this.expectPunct(Char.BraceR);
      return {
        kind: 'ObjectValue',
        fields,
      };
    }
    this.fail();
  }

  private parseType(): any {
    let type;
    if (this.eatPunct(Char.BracketL)) {
      type = {
        kind: 'ListType',
        type: this.parseType(),
      };
      this.expectPunct(Char.BracketR);
    } else {
      type = this.parseNamedType();
    }

    if (this.eatPunct(Char.Bang)) {
      return {
        kind: 'NonNullType',
        type,
      };
    }
    return type;
  }

  private parseNamedType(): any {
    return {
      kind: 'NamedType',
      name: this.parseName(),
    };
  }

  private parseName(): any {
    if (this.tokenKind !== TokenKind.Name) {
      this.fail();
    }
    const value = this.tokenValue;
    this.advance();
    return {
      kind: 'Name',
      value,
    };
  }

  private parseDescription(): any {
    return this.tokenKind === TokenKind.String ? this.parseStringValue() : undefined;
  }

  private parseStringValue(): any {
    if (this.tokenKind !== TokenKind.String) {
      this.fail();
    }
    const value = this.tokenValue;
    const block = this.tokenBlock;
    this.advance();
    return {
      kind: 'StringValue',
      value,
      block,
    };
  }

  private advance() {
    const source = this.source;
    const length = this.length;
    let position = this.position;
    while (position < length) {
      const ignoredCode = source.charCodeAt(position);
      if (ignoredCode === 9 || ignoredCode === 10 || ignoredCode === 13 || ignoredCode === 32 || ignoredCode === 44 || ignoredCode === 0xfeff) {
        position++;
        continue;
      }
      if (ignoredCode === Char.Hash) {
        position++;
        while (position < length) {
          const commentCode = source.charCodeAt(position);
          if (commentCode === 10 || commentCode === 13) {
            break;
          }
          if (!isValidSourceCharacter(source, position)) {
            this.fail();
          }
          position += commentCode >= 0xd800 && commentCode <= 0xdbff ? 2 : 1;
        }
        continue;
      }
      break;
    }
    this.position = position;
    if (position >= length) {
      this.tokenKind = TokenKind.EOF;
      this.tokenCode = 0;
      this.tokenValue = '';
      this.tokenBlock = false;
      return;
    }

    const code = source.charCodeAt(position);
    switch (code) {
      case Char.Bang:
      case Char.Dollar:
      case Char.Amp:
      case Char.ParenL:
      case Char.ParenR:
      case Char.Colon:
      case Char.Equals:
      case Char.At:
      case Char.BracketL:
      case Char.BracketR:
      case Char.BraceL:
      case Char.Pipe:
      case Char.BraceR:
        this.position = position + 1;
        this.tokenKind = TokenKind.Punctuator;
        this.tokenCode = code;
        this.tokenValue = '';
        this.tokenBlock = false;
        return;
    }
    if (isNameStart(code)) {
      this.readName();
      return;
    }
    if (isDigit(code) || code === Char.Minus) {
      this.readNumber();
      return;
    }
    if (code === Char.Quote) {
      if (source.charCodeAt(position + 1) === Char.Quote && source.charCodeAt(position + 2) === Char.Quote) {
        this.readBlockString();
      } else {
        this.readString();
      }
      return;
    }
    this.fail();
  }

  private readName() {
    const start = this.position;
    this.position++;
    while (this.position < this.length && isNameContinue(this.source.charCodeAt(this.position))) {
      this.position++;
    }
    this.tokenKind = TokenKind.Name;
    this.tokenCode = 0;
    this.tokenValue = this.source.slice(start, this.position);
    this.tokenBlock = false;
  }

  private readNumber() {
    const start = this.position;
    let code = this.source.charCodeAt(this.position);
    if (code === Char.Minus) {
      this.position++;
      code = this.source.charCodeAt(this.position);
      if (!isDigit(code)) {
        this.fail();
      }
    }

    if (code === Code.Zero) {
      this.position++;
      if (isDigit(this.source.charCodeAt(this.position))) {
        this.fail();
      }
    } else if (isNonZeroDigit(code)) {
      this.position++;
      while (isDigit(this.source.charCodeAt(this.position))) {
        this.position++;
      }
    } else {
      this.fail();
    }

    let kind = TokenKind.Int;
    if (this.source.charCodeAt(this.position) === Char.Dot) {
      kind = TokenKind.Float;
      this.position++;
      if (!isDigit(this.source.charCodeAt(this.position))) {
        this.fail();
      }
      while (isDigit(this.source.charCodeAt(this.position))) {
        this.position++;
      }
    }

    code = this.source.charCodeAt(this.position);
    if (code === Code.E || code === Code.e) {
      kind = TokenKind.Float;
      this.position++;
      code = this.source.charCodeAt(this.position);
      if (code === 43 || code === Char.Minus) {
        this.position++;
      }
      if (!isDigit(this.source.charCodeAt(this.position))) {
        this.fail();
      }
      while (isDigit(this.source.charCodeAt(this.position))) {
        this.position++;
      }
    }

    if (isNameStart(this.source.charCodeAt(this.position)) || this.source.charCodeAt(this.position) === Char.Dot) {
      this.fail();
    }

    this.tokenKind = kind;
    this.tokenCode = 0;
    this.tokenValue = this.source.slice(start, this.position);
    this.tokenBlock = false;
  }

  private readString() {
    let position = this.position + 1;
    let chunkStart = position;
    let value = '';
    while (position < this.length) {
      const code = this.source.charCodeAt(position);
      if (code === Char.Quote) {
        value += this.source.slice(chunkStart, position);
        this.position = position + 1;
        this.tokenKind = TokenKind.String;
        this.tokenCode = 0;
        this.tokenValue = value;
        this.tokenBlock = false;
        return;
      }
      if (code === Char.Backslash) {
        value += this.source.slice(chunkStart, position);
        const escape = this.readEscapedCharacter(position);
        value += escape.value;
        position += escape.size;
        chunkStart = position;
        continue;
      }
      if (code === 10 || code === 13 || !isValidSourceCharacter(this.source, position)) {
        this.fail();
      }
      position += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    }
    this.fail();
  }

  private readEscapedCharacter(position: number): { value: string; size: number } {
    const code = this.source.charCodeAt(position + 1);
    switch (code) {
      case Char.Quote:
        return { value: '"', size: 2 };
      case Char.Backslash:
        return { value: '\\', size: 2 };
      case 47:
        return { value: '/', size: 2 };
      case 98:
        return { value: '\b', size: 2 };
      case 102:
        return { value: '\f', size: 2 };
      case Code.n:
        return { value: '\n', size: 2 };
      case Code.r:
        return { value: '\r', size: 2 };
      case Code.t:
        return { value: '\t', size: 2 };
      case Code.u:
        if (this.source.charCodeAt(position + 2) === Char.BraceL) {
          return this.readVariableWidthUnicode(position);
        }
        return this.readFixedWidthUnicode(position);
    }
    this.fail();
  }

  private readVariableWidthUnicode(position: number): { value: string; size: number } {
    let point = 0;
    let size = 3;
    while (size < 12) {
      const code = this.source.charCodeAt(position + size++);
      if (code === Char.BraceR) {
        if (size < 5 || !isUnicodeScalarValue(point)) {
          break;
        }
        return { value: String.fromCodePoint(point), size };
      }
      const digit = readHexDigit(code);
      if (digit < 0) {
        break;
      }
      point = (point << 4) | digit;
    }
    this.fail();
  }

  private readFixedWidthUnicode(position: number): { value: string; size: number } {
    const code = read16BitHexCode(this.source, position + 2);
    if (isUnicodeScalarValue(code)) {
      return { value: String.fromCodePoint(code), size: 6 };
    }
    if (isLeadingSurrogate(code) && this.source.charCodeAt(position + 6) === Char.Backslash && this.source.charCodeAt(position + 7) === Code.u) {
      const trailing = read16BitHexCode(this.source, position + 8);
      if (isTrailingSurrogate(trailing)) {
        return { value: String.fromCodePoint(code, trailing), size: 12 };
      }
    }
    this.fail();
  }

  private readBlockString() {
    let position = this.position + 3;
    let chunkStart = position;
    let currentLine = '';
    const blockLines = [];

    while (position < this.length) {
      const code = this.source.charCodeAt(position);
      if (code === Char.Quote && this.source.charCodeAt(position + 1) === Char.Quote && this.source.charCodeAt(position + 2) === Char.Quote) {
        currentLine += this.source.slice(chunkStart, position);
        blockLines.push(currentLine);
        this.position = position + 3;
        this.tokenKind = TokenKind.String;
        this.tokenCode = 0;
        this.tokenValue = dedentBlockStringLines(blockLines).join('\n');
        this.tokenBlock = true;
        return;
      }
      if (
        code === Char.Backslash &&
        this.source.charCodeAt(position + 1) === Char.Quote &&
        this.source.charCodeAt(position + 2) === Char.Quote &&
        this.source.charCodeAt(position + 3) === Char.Quote
      ) {
        currentLine += this.source.slice(chunkStart, position);
        chunkStart = position + 1;
        position += 4;
        continue;
      }
      if (code === 10 || code === 13) {
        currentLine += this.source.slice(chunkStart, position);
        blockLines.push(currentLine);
        if (code === 13 && this.source.charCodeAt(position + 1) === 10) {
          position += 2;
        } else {
          position++;
        }
        currentLine = '';
        chunkStart = position;
        continue;
      }
      if (!isValidSourceCharacter(this.source, position)) {
        this.fail();
      }
      position += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    }
    this.fail();
  }

  private skipIgnored() {
    while (this.position < this.length) {
      const code = this.source.charCodeAt(this.position);
      if (code === 9 || code === 10 || code === 13 || code === 32 || code === 44 || code === 0xfeff) {
        this.position++;
        continue;
      }
      if (code === Char.Hash) {
        this.position++;
        while (this.position < this.length) {
          const commentCode = this.source.charCodeAt(this.position);
          if (commentCode === 10 || commentCode === 13) {
            break;
          }
          if (!isValidSourceCharacter(this.source, this.position)) {
            this.fail();
          }
          this.position += commentCode >= 0xd800 && commentCode <= 0xdbff ? 2 : 1;
        }
        continue;
      }
      break;
    }
  }

  private peekName(value: string) {
    return this.tokenKind === TokenKind.Name && this.tokenValue === value;
  }

  private eatName(value: string) {
    if (this.peekName(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectKeyword(value: string) {
    if (!this.eatName(value)) {
      this.fail();
    }
  }

  private peekPunct(code: number) {
    return this.tokenKind === TokenKind.Punctuator && this.tokenCode === code;
  }

  private eatPunct(code: number) {
    if (this.peekPunct(code)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expectPunct(code: number) {
    if (!this.eatPunct(code)) {
      this.fail();
    }
  }

  private fail(): never {
    throw new SdlParserFallback();
  }
}

function isNameStart(code: number) {
  return (code >= Code.A && code <= Code.Z) || (code >= Code.a && code <= Code.z) || code === Code.Underscore;
}

function isNameContinue(code: number) {
  return isNameStart(code) || isDigit(code);
}

function isDigit(code: number) {
  return code >= Code.Zero && code <= Code.Nine;
}

function isNonZeroDigit(code: number) {
  return code >= 49 && code <= Code.Nine;
}

function readHexDigit(code: number) {
  return code >= Code.Zero && code <= Code.Nine
    ? code - Code.Zero
    : code >= Code.A && code <= Code.F
      ? code - 55
      : code >= Code.a && code <= Code.f
        ? code - 87
        : -1;
}

function read16BitHexCode(source: string, position: number) {
  return (
    (readHexDigit(source.charCodeAt(position)) << 12) |
    (readHexDigit(source.charCodeAt(position + 1)) << 8) |
    (readHexDigit(source.charCodeAt(position + 2)) << 4) |
    readHexDigit(source.charCodeAt(position + 3))
  );
}

function isLeadingSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isTrailingSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isUnicodeScalarValue(code: number) {
  return (code >= 0x0009 && code <= 0x000a) || code === 0x000d || (code >= 0x0020 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0x10ffff);
}

function isValidSourceCharacter(source: string, position: number) {
  const code = source.charCodeAt(position);
  if (isUnicodeScalarValue(code)) {
    return true;
  }
  return isLeadingSurrogate(code) && isTrailingSurrogate(source.charCodeAt(position + 1));
}
