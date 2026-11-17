// Minimal declarations so src/core stays free of DOM and Node lib types
// while still using the TextEncoder/TextDecoder that both provide.
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
