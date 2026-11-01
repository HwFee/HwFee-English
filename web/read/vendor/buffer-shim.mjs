// Browser stand-in for the single Node API vendor/decode.mjs uses.
// Only Buffer.from(base64).toString() is needed; anything else throws loudly.
export const Buffer = {
  from(value, encoding) {
    if (encoding !== 'base64') throw new Error('buffer-shim: only base64 decoding is supported');
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return {
      toString: () => new TextDecoder('utf-8').decode(bytes),
    };
  },
};
