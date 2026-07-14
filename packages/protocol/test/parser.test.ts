// Ported from flybrix-serialization/test/parser.js (Jasmine -> Vitest).
import { describe, expect, it } from 'vitest';
import { lexer, parse, tokenizer, TokenCategory } from '../src/index.js';

describe('tokenizer', () => {
  it('rejects invalid characters', () => {
    expect(() => tokenizer('Foo = { bar: u8, baz: v7[44}]/\n\r\t//()::;,')).not.toThrow();
    expect(() => tokenizer('\\$%^')).toThrow();
  });

  it('splits into relevant symbols and strings', () => {
    const tokens = tokenizer('Foo = { bar: u8, baz: v7[44}]/\n\r\t//()::;,');
    expect(tokens.map((v) => v.value)).toEqual([
      'Foo', '=', '{', 'bar', ':', 'u8', ',', 'baz', ':', 'v7', '[',
      '44', '}', ']', '/', '/', '/', '(', ')', ':', ':', ';', ',',
    ]);
    expect(tokens.map((v) => v.position)).toEqual([
      0, 4, 6, 8, 11, 13, 15, 17, 20, 22, 24,
      25, 27, 28, 29, 33, 34, 35, 36, 37, 38, 39, 40,
    ]);
  });
});

describe('lexer', () => {
  it('categorizes tokens and parses numbers', () => {
    const tokens = lexer(tokenizer('Foo = [ u8 : 44 ];'));
    expect(tokens.map((v) => v.value)).toEqual(['Foo', '=', '[', 'u8', ':', 44, ']', ';']);
    expect(tokens.map((v) => v.category)).toEqual([
      TokenCategory.NAME,
      TokenCategory.SYMBOL,
      TokenCategory.SYMBOL,
      TokenCategory.NAME,
      TokenCategory.SYMBOL,
      TokenCategory.NUMBER,
      TokenCategory.SYMBOL,
      TokenCategory.SYMBOL,
    ]);
  });
});

describe('parse', () => {
  it('handles one name alias', () => {
    const handlers = parse('V=u8;');
    expect(Object.keys(handlers).sort()).toEqual(['V']);
    expect(handlers.V.descriptor).toBe('u8');
  });

  it('handles multiple name aliases', () => {
    const handlers = parse(
      'Vu8=u8;' +
        'Vu16=u16;' +
        'Vu32=u32;' +
        'Vi8=i8;' +
        'Vi16=i16;' +
        'Vi32=i32;' +
        'Vf32=f32;' +
        'Vf64=f64;' +
        'Vs12=s12;' +
        'Vs3=s3;' +
        'Vindirect=Vs12;' +
        'Vindirecter=Vindirect;',
    );
    expect(handlers.Vu8.descriptor).toBe('u8');
    expect(handlers.Vu16.descriptor).toBe('u16');
    expect(handlers.Vu32.descriptor).toBe('u32');
    expect(handlers.Vi8.descriptor).toBe('i8');
    expect(handlers.Vi16.descriptor).toBe('i16');
    expect(handlers.Vi32.descriptor).toBe('i32');
    expect(handlers.Vf32.descriptor).toBe('f32');
    expect(handlers.Vf64.descriptor).toBe('f64');
    expect(handlers.Vs12.descriptor).toBe('s12');
    expect(handlers.Vs3.descriptor).toBe('s3');
    expect(handlers.Vindirect.descriptor).toBe('s12');
    expect(handlers.Vindirecter.descriptor).toBe('s12');
  });

  it('handles arrays', () => {
    expect(parse('V=[u8:12];').V.descriptor).toBe('[u8:12]');
  });

  it('handles masked arrays', () => {
    expect(parse('V=[//u8:12];').V.descriptor).toBe('[/16/u8:12]');
    expect(parse('V=[/20/u8:12];').V.descriptor).toBe('[/24/u8:12]');
  });

  it('handles tuples', () => {
    expect(parse('V=(u8,i16,s4);').V.descriptor).toBe('(u8,i16,s4)');
  });

  it('handles masked tuples', () => {
    expect(parse('V=(//u8,i16,s4);').V.descriptor).toBe('(/8/u8,i16,s4)');
    expect(parse('V=(/20/u8,i16,s4);').V.descriptor).toBe('(/24/u8,i16,s4)');
  });

  it('handles structures', () => {
    expect(parse('V={a:u8,b:u16,c:s32};').V.descriptor).toBe('{a:u8,b:u16,c:s32}');
  });

  it('handles masked structures', () => {
    expect(parse('V={//a:u8,b:u16,c:s32};').V.descriptor).toBe('{/8/a:u8,b:u16,c:s32}');
    expect(parse('V={/10/a:u8,b:u16,c:s32};').V.descriptor).toBe('{/16/a:u8,b:u16,c:s32}');
  });

  it('rejects lowercase structure names', () => {
    expect(() => parse('v=u8;')).toThrow('Structure names cannot start with lowercase letters');
  });

  it('rejects unknown types', () => {
    expect(() => parse('V=nosuchtype;')).toThrow('Unrecognized type "nosuchtype"');
  });

  it('rejects the MASK field name', () => {
    expect(() => parse('V={MASK:u8};')).toThrow('Disallowed name "MASK" given');
  });

  it('handles a config', () => {
    const text =
      'Version = {' +
      '  major: u8,' +
      '  minor: u8,' +
      '  patch: u8' +
      '};' +
      'Vector3 = {' +
      '  x: f32,' +
      '  y: f32,' +
      '  z: f32' +
      '};' +
      'Color = {' +
      '  red: u8,' +
      '  green: u8,' +
      '  blue: u8' +
      '};' +
      'Led = {' +
      '  color1: Color,' +
      '  color2: Color,' +
      '  pattern: u8' +
      '};' +
      'Configuration = {/16/' +
      '  version: Version,' +
      '  magnetometerBias: Vector3,' +
      '  name: s,' +
      '  ledPatterns: [// Led : 16]' +
      '};' +
      'Commands = {/32/' +
      '  setConfig: Configuration,' +
      '  getConfig: {' +
      '    mainMask: u16,' +
      '    ledMask: u16' +
      '  }' +
      '};' +
      'Response = {' +
      '  requests: u32,' +
      '  successful: u32' +
      '};';
    const handlers = parse(text);
    expect(Object.keys(handlers).sort()).toEqual([
      'Color',
      'Commands',
      'Configuration',
      'Led',
      'Response',
      'Vector3',
      'Version',
    ]);
    expect(handlers.Color.descriptor).toBe('{red:u8,green:u8,blue:u8}');
    expect(handlers.Version.descriptor).toBe('{major:u8,minor:u8,patch:u8}');
    expect(handlers.Vector3.descriptor).toBe('{x:f32,y:f32,z:f32}');
    expect(handlers.Response.descriptor).toBe('{requests:u32,successful:u32}');
    expect(handlers.Led.descriptor).toBe(
      '{color1:{red:u8,green:u8,blue:u8},color2:{red:u8,green:u8,blue:u8},pattern:u8}',
    );
    expect(handlers.Configuration.descriptor).toBe(
      '{/16/version:{major:u8,minor:u8,patch:u8},magnetometerBias:{x:f32,y:f32,z:f32},name:s,ledPatterns:[/16/{color1:{red:u8,green:u8,blue:u8},color2:{red:u8,green:u8,blue:u8},pattern:u8}:16]}',
    );
    expect(handlers.Commands.descriptor).toBe(
      '{/32/setConfig:{/16/version:{major:u8,minor:u8,patch:u8},magnetometerBias:{x:f32,y:f32,z:f32},name:s,ledPatterns:[/16/{color1:{red:u8,green:u8,blue:u8},color2:{red:u8,green:u8,blue:u8},pattern:u8}:16]},getConfig:{mainMask:u16,ledMask:u16}}',
    );
  });
});
