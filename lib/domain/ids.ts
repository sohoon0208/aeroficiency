const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ENTITY_ID_LENGTH = 30;

function encodeBase32(value: number, length: number) {
  let remaining = Math.max(0, Math.floor(value));
  let encoded = '';
  for (let index = 0; index < length; index += 1) {
    encoded = CROCKFORD[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function randomBase32(length: number) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CROCKFORD[byte % 32]).join('');
}

export function createEntityId<TPrefix extends 'des' | 'ana' | 'act'>(prefix: TPrefix): `${TPrefix}_${string}` {
  const time = encodeBase32(Date.now(), 10);
  return `${prefix}_${time}${randomBase32(16)}`;
}

export function createIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

export function stableStringify(value: unknown): string {
  const active = new WeakSet<object>();
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
      return JSON.stringify(Object.is(item, -0) ? 0 : item);
    }
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item !== 'object') throw new TypeError(`Canonical JSON rejects ${typeof item} values.`);
    if (active.has(item)) throw new TypeError('Canonical JSON rejects cyclic values.');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Canonical JSON accepts only arrays and plain objects.');
    active.add(item);
    let encoded: string;
    if (Array.isArray(item)) {
      encoded = `[${item.map(encode).join(',')}]`;
    } else {
      const object = item as Record<string, unknown>;
      encoded = `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${encode(object[key])}`).join(',')}}`;
    }
    active.delete(item);
    return encoded;
  };
  return encode(value);
}

export function fnv1aHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, places: number) {
  return (value >>> places) | (value << (32 - places));
}

export function sha256(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 2 ** 32);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = Array(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + 4 * index;
      words[index] = ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function inputFingerprint(value: unknown) {
  return `fp_${sha256(stableStringify(value))}`;
}
