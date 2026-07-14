/**
 * Schema-DSL parser for Flybrix protocol descriptors.
 * Ported from flybrix-serialization/src/parser.js.
 *
 * Grammar (informal):
 *   <structure> := <Name> = <type> ;
 *   <type>      := <name> | { <mask?> k:v, ... } | ( <mask?> t, ... ) | [ <mask?> t : count ]
 *   <mask>      := "//" (bit count from child count) | "/N/" (at least N bits)
 */
import { Handler, HandlerLibrary, handlers, MapChild } from './handlers.js';

export class StringToken {
  constructor(
    public position: number,
    public value: string,
  ) {}
}

const numericTest = /^\d+$/;
const nameTest = /^\w+$/;

export enum TokenCategory {
  SYMBOL = 0,
  NUMBER = 1,
  NAME = 2,
}

export class Token {
  position: number;
  value: string | number;
  category: TokenCategory;

  constructor(stringToken: StringToken) {
    this.position = stringToken.position;
    this.value = stringToken.value;
    if (numericTest.test(stringToken.value)) {
      this.category = TokenCategory.NUMBER;
      this.value = parseInt(stringToken.value, 10);
    } else if (nameTest.test(stringToken.value)) {
      this.category = TokenCategory.NAME;
    } else {
      this.category = TokenCategory.SYMBOL;
    }
  }
}

interface DslError {
  position: number;
  error: string;
}

const dslError = (position: number, error: string): DslError => ({ position, error });

const validCharSetTest = /^[{}[\]()/=:,;\w\s]*$/;

export const isValid = (text: string): boolean => validCharSetTest.test(text);

export const tokenizer = (text: string): StringToken[] => {
  if (!isValid(text)) {
    throw new Error('Passed config contains invalid characters');
  }
  const re = /([{}[\]()/=:,;]|\w+)/g;
  let match: RegExpExecArray | null;
  const matches: StringToken[] = [];
  while ((match = re.exec(text)) !== null) {
    matches.push(new StringToken(match.index, match[0]));
  }
  return matches;
};

export const lexer = (tokens: StringToken[]): Token[] =>
  tokens.map((token) => new Token(token));

export enum TypeCategory {
  NAMED = 0,
  MAP_UNMASKED = 2,
  MAP_MASKED = 3,
  TUPLE_UNMASKED = 4,
  TUPLE_MASKED = 5,
  ARRAY_UNMASKED = 6,
  ARRAY_MASKED = 7,
}

interface NamedTypeChild {
  name: string;
  value: Type;
}

interface ArrayTypeChildren {
  value: Type;
  count: number;
}

type TypeProperties = string | NamedTypeChild[] | Type[] | ArrayTypeChildren;

export class Type {
  constructor(
    public category: TypeCategory,
    public properties: TypeProperties,
    public mask: number = 0,
  ) {}

  generateHandler(library: HandlerLibrary): Handler {
    const props = this.properties;
    const mask = this.mask;
    switch (this.category) {
      case TypeCategory.NAMED: {
        const name = props as string;
        let handler: Handler | null = null;
        if (name in handlers) {
          const candidate = (handlers as Record<string, unknown>)[name];
          if (candidate instanceof Handler && candidate.isBasic) {
            handler = candidate;
          }
        } else if (name[0] === 's' && numericTest.test(name.substring(1))) {
          handler = handlers.string(parseInt(name.substring(1), 10));
        } else if (name in library) {
          handler = library[name];
        }
        if (!handler) {
          throw dslError(-1, 'Unrecognized type "' + name + '"');
        }
        return handler;
      }
      case TypeCategory.MAP_UNMASKED: {
        const children: MapChild[] = (props as NamedTypeChild[]).map((child) => ({
          key: child.name,
          handler: child.value.generateHandler(library),
        }));
        return handlers.mapUnmasked(children);
      }
      case TypeCategory.MAP_MASKED: {
        const children: MapChild[] = (props as NamedTypeChild[]).map((child) => ({
          key: child.name,
          handler: child.value.generateHandler(library),
        }));
        return handlers.mapMasked(children, mask);
      }
      case TypeCategory.TUPLE_UNMASKED: {
        const children = (props as Type[]).map((child) => child.generateHandler(library));
        return handlers.tupleUnmasked(children);
      }
      case TypeCategory.TUPLE_MASKED: {
        const children = (props as Type[]).map((child) => child.generateHandler(library));
        return handlers.tupleMasked(children, mask);
      }
      case TypeCategory.ARRAY_UNMASKED: {
        const arrayProps = props as ArrayTypeChildren;
        return handlers.arrayUnmasked(arrayProps.count, arrayProps.value.generateHandler(library));
      }
      case TypeCategory.ARRAY_MASKED: {
        const arrayProps = props as ArrayTypeChildren;
        return handlers.arrayMasked(
          arrayProps.count,
          arrayProps.value.generateHandler(library),
          mask,
        );
      }
      default:
        throw dslError(-1, 'Unrecognized type category');
    }
  }
}

/** Token cursor, playing the role the generic Serializer played in the legacy code. */
class TokenStream {
  index = 0;

  constructor(public tokens: Token[]) {}

  add(increment: number): void {
    this.index += increment;
  }
}

const readToken = (stream: TokenStream): Token => {
  const token = stream.tokens[stream.index];
  stream.add(1);
  if (!token) {
    throw dslError(-1, 'Unexpected end of string');
  }
  return token;
};

const nameParser = (stream: TokenStream): string => {
  const token = readToken(stream);
  if (token.category !== TokenCategory.NAME) {
    throw dslError(token.position, 'Expected name, got: "' + token.value + '"');
  }
  if (token.value === 'MASK') {
    throw dslError(token.position, 'Disallowed name "MASK" given');
  }
  return token.value as string;
};

const numberParser = (stream: TokenStream): number => {
  const token = readToken(stream);
  if (token.category !== TokenCategory.NUMBER) {
    throw dslError(token.position, 'Expected number, got: "' + token.value + '"');
  }
  return token.value as number;
};

const consumeSymbol = (stream: TokenStream, symbol: string): void => {
  const token = readToken(stream);
  if (token.value !== symbol) {
    throw dslError(token.position, 'Expected "' + symbol + '", got: "' + token.value + '"');
  }
};

type MaskDescription =
  | { masked: false }
  | { masked: true; defined: false }
  | { masked: true; defined: true; value: number };

const maskParser = (stream: TokenStream): MaskDescription => {
  // "//" or "/<NUMBER>/", otherwise there is no mask
  let token = readToken(stream);
  if (token.value !== '/') {
    stream.add(-1);
    return { masked: false };
  }
  token = readToken(stream);
  if (token.value === '/') {
    return { masked: true, defined: false };
  }
  if (token.category !== TokenCategory.NUMBER) {
    throw dslError(token.position, 'Expected "/" or number');
  }
  const value = token.value as number;
  token = readToken(stream);
  if (token.value !== '/') {
    throw dslError(token.position, 'Expected "/"');
  }
  return { masked: true, defined: true, value };
};

const typeMapParser = (stream: TokenStream): Type => {
  // {<MASK> <NAME>:<TYPE>, <NAME>:<TYPE>, <NAME>:<TYPE>}
  const mask = maskParser(stream);
  const children: NamedTypeChild[] = [];
  for (;;) {
    const name = nameParser(stream);
    consumeSymbol(stream, ':');
    const value = typeParser(stream);
    children.push({ name, value });
    const token = readToken(stream);
    if (token.value === '}') {
      if (mask.masked) {
        if (mask.defined) {
          return new Type(TypeCategory.MAP_MASKED, children, mask.value);
        }
        return new Type(TypeCategory.MAP_MASKED, children);
      }
      return new Type(TypeCategory.MAP_UNMASKED, children);
    }
    if (token.value !== ',') {
      throw dslError(token.position, 'Unexpected token after map element: "' + token.value + '"');
    }
  }
};

const typeTupleParser = (stream: TokenStream): Type => {
  // (<MASK> <TYPE>, <TYPE>, <TYPE>)
  const mask = maskParser(stream);
  const children: Type[] = [];
  for (;;) {
    children.push(typeParser(stream));
    const token = readToken(stream);
    if (token.value === ')') {
      if (mask.masked) {
        if (mask.defined) {
          return new Type(TypeCategory.TUPLE_MASKED, children, mask.value);
        }
        return new Type(TypeCategory.TUPLE_MASKED, children);
      }
      return new Type(TypeCategory.TUPLE_UNMASKED, children);
    }
    if (token.value !== ',') {
      throw dslError(token.position, 'Unexpected token after tuple element: "' + token.value + '"');
    }
  }
};

const typeArrayParser = (stream: TokenStream): Type => {
  // [<MASK> <TYPE>:<NUMBER>]
  const mask = maskParser(stream);
  const value = typeParser(stream);
  consumeSymbol(stream, ':');
  const count = numberParser(stream);
  consumeSymbol(stream, ']');
  const children: ArrayTypeChildren = { value, count };
  if (mask.masked) {
    if (mask.defined) {
      return new Type(TypeCategory.ARRAY_MASKED, children, mask.value);
    }
    return new Type(TypeCategory.ARRAY_MASKED, children);
  }
  return new Type(TypeCategory.ARRAY_UNMASKED, children);
};

const typeParser = (stream: TokenStream): Type => {
  // Options: <NAME> | Tuple | Array | Map
  const token = readToken(stream);
  if (token.category === TokenCategory.NUMBER) {
    throw dslError(token.position, 'Unexpected number, type expected');
  }
  if (token.category === TokenCategory.NAME) {
    return new Type(TypeCategory.NAMED, token.value as string);
  }
  if (token.value === '{') {
    return typeMapParser(stream);
  }
  if (token.value === '[') {
    return typeArrayParser(stream);
  }
  if (token.value === '(') {
    return typeTupleParser(stream);
  }
  throw dslError(token.position, 'Unexpected token when describing type: "' + token.value + '"');
};

export interface Structure {
  name: string;
  value: Type;
}

export const parser = (tokens: Token[]): Structure[] => {
  const stream = new TokenStream(tokens);
  const structures: Structure[] = [];
  while (stream.index < stream.tokens.length) {
    const name = nameParser(stream);
    if (name[0] !== name[0].toUpperCase()) {
      throw dslError(-1, 'Structure names cannot start with lowercase letters');
    }
    consumeSymbol(stream, '=');
    const value = typeParser(stream);
    consumeSymbol(stream, ';');
    structures.push({ name, value });
  }
  return structures;
};

const createHandlers = (structures: Structure[]): HandlerLibrary => {
  const library: HandlerLibrary = {};
  structures.forEach((entry) => {
    library[entry.name] = entry.value.generateHandler(library);
  });
  return library;
};

/**
 * Parse a descriptor text into a library of named handlers.
 * Throws a plain Error whose message matches the legacy implementation.
 */
export const parse = (text: string): HandlerLibrary => {
  try {
    return createHandlers(parser(lexer(tokenizer(text))));
  } catch (err) {
    const message =
      (err as DslError).error !== undefined ? (err as DslError).error : (err as Error).message;
    throw new Error(message);
  }
};
