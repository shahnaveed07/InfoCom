// First-party WebAuthn Level 2/3 cryptographic verification engine for Cloudflare Workers Free.
// Pure Web Crypto API (crypto.subtle) + RFC 8949 CBOR + COSE (ES256/RS256) + ASN.1 DER SPKI.
// Zero external WASM, zero Node-only crypto dependencies, ~1-2 ms CPU per ceremony.

export const COSE_ALG_ES256 = -7;
export const COSE_ALG_RS256 = -257;
export const SUPPORTED_COSE_ALGORITHMS = [COSE_ALG_ES256, COSE_ALG_RS256] as const;

export type SupportedCoseAlgorithm = (typeof SUPPORTED_COSE_ALGORITHMS)[number];

export interface WebAuthnRpConfig {
  rpId: string;
  rpName: string;
  expectedOrigin: string;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: {
    raw: number;
    userPresent: boolean;
    userVerified: boolean;
    backupEligible: boolean;
    backupState: boolean;
    attestedCredentialData: boolean;
    extensionData: boolean;
  };
  signCount: number;
  attestedCredentialData?: {
    aaguid: string;
    credentialId: Uint8Array;
    credentialPublicKeyCose: Map<number, unknown>;
  };
}

export interface VerifiedRegistrationResult {
  credentialId: string;
  publicKeySpki: string;
  coseAlgorithm: SupportedCoseAlgorithm;
  signCount: number;
  aaguid: string;
  backupEligible: boolean;
  backupState: boolean;
  transports: string[];
}

export interface VerifiedAuthenticationResult {
  newSignCount: number;
  backupEligible: boolean;
  backupState: boolean;
}

export class WebAuthnVerificationError extends Error {
  readonly code: string;
  readonly cloneSuspected: boolean;

  constructor(code: string, message: string, cloneSuspected = false) {
    super(message);
    this.name = 'WebAuthnVerificationError';
    this.code = code;
    this.cloneSuspected = cloneSuspected;
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(input: string): Uint8Array {
  if (typeof input !== 'string' || input.length === 0) {
    throw new WebAuthnVerificationError('INVALID_BASE64URL', 'Missing base64url payload.');
  }
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(input)) {
    throw new WebAuthnVerificationError('INVALID_BASE64URL', 'Malformed base64url encoding.');
  }
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return constantTimeBytesEqual(enc.encode(a), enc.encode(b));
}

export async function sha256Bytes(data: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = await sha256Bytes(data);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateChallengeBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function resolveWebAuthnRpConfig(
  request: Request,
  env?: { APP_URL?: string; WEBAUTHN_RP_ID?: string; WEBAUTHN_RP_NAME?: string }
): WebAuthnRpConfig {
  const requestOrigin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  let canonicalOrigin = requestUrl.origin;

  const isLocalReq =
    requestUrl.hostname === 'localhost' ||
    requestUrl.hostname === '127.0.0.1' ||
    requestUrl.hostname === '0.0.0.0';

  if (isLocalReq && requestOrigin) {
    try {
      const parsedReqOrigin = new URL(requestOrigin);
      if (
        (parsedReqOrigin.hostname === 'localhost' || parsedReqOrigin.hostname === '127.0.0.1') &&
        parsedReqOrigin.port === requestUrl.port
      ) {
        canonicalOrigin = parsedReqOrigin.origin;
      }
    } catch {
      // Ignore malformed origin header; verifyClientDataJson will reject mismatched origins
    }
  } else if (env?.APP_URL && !env.APP_URL.includes('<your-subdomain>')) {
    try {
      canonicalOrigin = new URL(env.APP_URL).origin;
    } catch {
      // Fallback to requestUrl.origin if APP_URL is not a valid URL
    }
  } else if (requestOrigin) {
    try {
      const parsedReqOrigin = new URL(requestOrigin);
      if (parsedReqOrigin.origin === requestUrl.origin) {
        canonicalOrigin = parsedReqOrigin.origin;
      }
    } catch {
      // Ignore malformed origin header; verifyClientDataJson will reject mismatched origins
    }
  }

  const originUrl = new URL(canonicalOrigin);
  const rpId =
    env?.WEBAUTHN_RP_ID && env.WEBAUTHN_RP_ID.trim().length > 0
      ? env.WEBAUTHN_RP_ID.trim().toLowerCase()
      : originUrl.hostname.toLowerCase();

  return {
    rpId,
    rpName: env?.WEBAUTHN_RP_NAME?.trim() || 'IGS — InfoCom Global Services',
    expectedOrigin: canonicalOrigin,
  };
}

// ============================================================================
// RFC 8949 Strict CBOR Decoder (Subset required for WebAuthn Attestation & COSE)
// ============================================================================

interface CborDecodeResult {
  value: unknown;
  nextOffset: number;
}

const MAX_CBOR_DEPTH = 16;

function readCborUint(bytes: Uint8Array, offset: number, additionalInfo: number): { value: number; nextOffset: number } {
  if (additionalInfo < 24) {
    return { value: additionalInfo, nextOffset: offset };
  }
  if (additionalInfo === 24) {
    if (offset + 1 > bytes.length) {
      throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR 1-byte integer.');
    }
    return { value: bytes[offset], nextOffset: offset + 1 };
  }
  if (additionalInfo === 25) {
    if (offset + 2 > bytes.length) {
      throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR 2-byte integer.');
    }
    return { value: (bytes[offset] << 8) | bytes[offset + 1], nextOffset: offset + 2 };
  }
  if (additionalInfo === 26) {
    if (offset + 4 > bytes.length) {
      throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR 4-byte integer.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    return { value: view.getUint32(0, false), nextOffset: offset + 4 };
  }
  if (additionalInfo === 27) {
    if (offset + 8 > bytes.length) {
      throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR 8-byte integer.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const hi = view.getUint32(0, false);
    const lo = view.getUint32(4, false);
    const val = hi * 0x100000000 + lo;
    if (!Number.isSafeInteger(val)) {
      throw new WebAuthnVerificationError('INVALID_CBOR', 'CBOR integer exceeds safe range.');
    }
    return { value: val, nextOffset: offset + 8 };
  }
  throw new WebAuthnVerificationError('INVALID_CBOR', `Unsupported CBOR additional info ${additionalInfo}.`);
}

function decodeCborItem(bytes: Uint8Array, startOffset: number, depth: number): CborDecodeResult {
  if (depth > MAX_CBOR_DEPTH) {
    throw new WebAuthnVerificationError('INVALID_CBOR', 'CBOR nesting depth limit exceeded.');
  }
  if (startOffset >= bytes.length) {
    throw new WebAuthnVerificationError('INVALID_CBOR', 'Unexpected end of CBOR payload.');
  }

  const initial = bytes[startOffset];
  const majorType = initial >> 5;
  const additionalInfo = initial & 0x1f;
  let offset = startOffset + 1;

  switch (majorType) {
    case 0: {
      // Unsigned integer
      const { value, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      return { value, nextOffset };
    }
    case 1: {
      // Negative integer: -1 - n
      const { value, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      return { value: -1 - value, nextOffset };
    }
    case 2: {
      // Byte string
      const { value: length, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      if (nextOffset + length > bytes.length) {
        throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR byte string.');
      }
      return {
        value: bytes.slice(nextOffset, nextOffset + length),
        nextOffset: nextOffset + length,
      };
    }
    case 3: {
      // UTF-8 text string
      const { value: length, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      if (nextOffset + length > bytes.length) {
        throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR text string.');
      }
      const slice = bytes.subarray(nextOffset, nextOffset + length);
      return {
        value: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(slice),
        nextOffset: nextOffset + length,
      };
    }
    case 4: {
      // Array
      const { value: count, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      offset = nextOffset;
      const arr: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        const item = decodeCborItem(bytes, offset, depth + 1);
        arr.push(item.value);
        offset = item.nextOffset;
      }
      return { value: arr, nextOffset: offset };
    }
    case 5: {
      // Map (returned as Map so integer COSE keys stay numbers and string keys stay strings)
      const { value: count, nextOffset } = readCborUint(bytes, offset, additionalInfo);
      offset = nextOffset;
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < count; i += 1) {
        const keyItem = decodeCborItem(bytes, offset, depth + 1);
        const valItem = decodeCborItem(bytes, keyItem.nextOffset, depth + 1);
        if (map.has(keyItem.value)) {
          throw new WebAuthnVerificationError('INVALID_CBOR', 'Duplicate CBOR map key.');
        }
        map.set(keyItem.value, valItem.value);
        offset = valItem.nextOffset;
      }
      return { value: map, nextOffset: offset };
    }
    case 6: {
      // Semantic tag (decode inner item)
      const { nextOffset } = readCborUint(bytes, offset, additionalInfo);
      return decodeCborItem(bytes, nextOffset, depth + 1);
    }
    case 7: {
      if (additionalInfo === 20) return { value: false, nextOffset: offset };
      if (additionalInfo === 21) return { value: true, nextOffset: offset };
      if (additionalInfo === 22) return { value: null, nextOffset: offset };
      if (additionalInfo === 23) return { value: undefined, nextOffset: offset };
      if (additionalInfo === 24) {
        if (offset + 1 > bytes.length) {
          throw new WebAuthnVerificationError('INVALID_CBOR', 'Truncated CBOR simple value.');
        }
        return { value: bytes[offset], nextOffset: offset + 1 };
      }
      if (additionalInfo === 25) return { value: 0, nextOffset: offset + 2 };
      if (additionalInfo === 26) return { value: 0, nextOffset: offset + 4 };
      if (additionalInfo === 27) return { value: 0, nextOffset: offset + 8 };
      throw new WebAuthnVerificationError('INVALID_CBOR', `Unsupported CBOR simple value ${additionalInfo}.`);
    }
    default:
      throw new WebAuthnVerificationError('INVALID_CBOR', 'Invalid CBOR major type.');
  }
}

export function decodeCbor(bytes: Uint8Array): unknown {
  const result = decodeCborItem(bytes, 0, 0);
  if (result.nextOffset !== bytes.length) {
    throw new WebAuthnVerificationError('INVALID_CBOR', 'Trailing bytes after CBOR object.');
  }
  return result.value;
}

export function decodeCborPrefix(bytes: Uint8Array, offset = 0): CborDecodeResult {
  return decodeCborItem(bytes, offset, 0);
}

// ============================================================================
// ASN.1 DER Encoders / Decoders for SPKI Public Keys & ECDSA Signatures
// ============================================================================

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function encodeDerLength(len: number): Uint8Array {
  if (len < 0x80) {
    return new Uint8Array([len]);
  }
  const octets: number[] = [];
  let remaining = len;
  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function encodeDerTag(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([tag]), encodeDerLength(content.length), content);
}

function encodeDerUnsignedInteger(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0x00) {
    start += 1;
  }
  const trimmed = raw.subarray(start);
  const needsZeroPrefix = (trimmed[0] & 0x80) !== 0;
  const content = needsZeroPrefix
    ? concatBytes(new Uint8Array([0x00]), trimmed)
    : trimmed;
  return encodeDerTag(0x02, content);
}

// Fixed ASN.1 DER SPKI prefix for EC P-256 (prime256v1) uncompressed 65-byte point:
// SEQUENCE (89) -> SEQUENCE (19: OID ecPublicKey, OID prime256v1) -> BIT STRING (66: 0x00, 0x04, X[32], Y[32])
const EC_P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  0x04,
]);

// AlgorithmIdentifier for rsaEncryption (OID 1.2.840.113549.1.1.1 + NULL)
const RSA_ENCRYPTION_ALG_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
]);

export function cosePublicKeyToSpki(coseMap: Map<number, unknown>): {
  spkiBytes: Uint8Array;
  algorithm: SupportedCoseAlgorithm;
} {
  const kty = coseMap.get(1);
  const alg = coseMap.get(3);

  if (alg === COSE_ALG_ES256) {
    const crv = coseMap.get(-1);
    const x = coseMap.get(-2);
    const y = coseMap.get(-3);
    if (kty !== 2 || crv !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new WebAuthnVerificationError(
        'INVALID_COSE_KEY',
        'ES256 COSE key must be EC2 P-256 with x and y coordinates.'
      );
    }
    if (x.length !== 32 || y.length !== 32) {
      throw new WebAuthnVerificationError(
        'INVALID_COSE_KEY',
        'ES256 P-256 coordinates must be 32 bytes each.'
      );
    }
    return {
      spkiBytes: concatBytes(EC_P256_SPKI_PREFIX, x, y),
      algorithm: COSE_ALG_ES256,
    };
  }

  if (alg === COSE_ALG_RS256) {
    const n = coseMap.get(-1);
    const e = coseMap.get(-2);
    if (kty !== 3 || !(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new WebAuthnVerificationError(
        'INVALID_COSE_KEY',
        'RS256 COSE key must be RSA with modulus n and exponent e.'
      );
    }
    if (n.length < 256 || e.length === 0) {
      throw new WebAuthnVerificationError(
        'INVALID_COSE_KEY',
        'RS256 key must be at least 2048 bits.'
      );
    }
    const rsaPubKeySeq = encodeDerTag(
      0x30,
      concatBytes(encodeDerUnsignedInteger(n), encodeDerUnsignedInteger(e))
    );
    const bitString = encodeDerTag(0x03, concatBytes(new Uint8Array([0x00]), rsaPubKeySeq));
    const spkiBytes = encodeDerTag(0x30, concatBytes(RSA_ENCRYPTION_ALG_ID, bitString));
    return {
      spkiBytes,
      algorithm: COSE_ALG_RS256,
    };
  }

  throw new WebAuthnVerificationError(
    'UNSUPPORTED_ALGORITHM',
    `Unsupported WebAuthn COSE algorithm ${String(alg)}. Expected ES256 (-7) or RS256 (-257).`
  );
}

/**
 * Converts an ASN.1 DER encoded ECDSA signature (returned by WebAuthn authenticators)
 * into IEEE P1363 raw 64-byte (r || s) format required by Web Crypto subtle.verify().
 */
export function derEcdsaSignatureToRawP1363(der: Uint8Array, coordinateBytes = 32): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Invalid ASN.1 DER ECDSA signature.');
  }
  let offset = 1;
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    if (lenBytes === 0 || lenBytes > 2 || offset + lenBytes > der.length) {
      throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Invalid DER sequence length.');
    }
    seqLen = 0;
    for (let i = 0; i < lenBytes; i += 1) {
      seqLen = (seqLen << 8) | der[offset++];
    }
  }
  if (offset + seqLen !== der.length) {
    throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'DER signature length mismatch.');
  }

  const readInt = (): Uint8Array => {
    if (offset + 2 > der.length || der[offset] !== 0x02) {
      throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Expected DER INTEGER in ECDSA signature.');
    }
    offset += 1;
    const intLen = der[offset++];
    if (intLen === 0 || offset + intLen > der.length) {
      throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Invalid DER INTEGER length.');
    }
    let slice = der.subarray(offset, offset + intLen);
    offset += intLen;
    // Strip single leading 0x00 sign byte if present
    while (slice.length > coordinateBytes && slice[0] === 0x00) {
      slice = slice.subarray(1);
    }
    if (slice.length > coordinateBytes) {
      throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'ECDSA integer exceeds curve size.');
    }
    const padded = new Uint8Array(coordinateBytes);
    padded.set(slice, coordinateBytes - slice.length);
    return padded;
  };

  const r = readInt();
  const s = readInt();
  if (offset !== der.length) {
    throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Trailing bytes in DER ECDSA signature.');
  }
  return concatBytes(r, s);
}

// ============================================================================
// WebAuthn AuthenticatorData, ClientDataJSON, Registration & Login Verification
// ============================================================================

function formatAaguid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function parseAuthenticatorData(authData: Uint8Array): ParsedAuthenticatorData {
  if (authData.length < 37) {
    throw new WebAuthnVerificationError(
      'INVALID_AUTH_DATA',
      'Authenticator data shorter than mandatory 37 bytes.'
    );
  }
  const rpIdHash = authData.slice(0, 32);
  const rawFlags = authData[32];
  const view = new DataView(authData.buffer, authData.byteOffset + 33, 4);
  const signCount = view.getUint32(0, false);

  const flags = {
    raw: rawFlags,
    userPresent: (rawFlags & 0x01) !== 0,
    userVerified: (rawFlags & 0x04) !== 0,
    backupEligible: (rawFlags & 0x08) !== 0,
    backupState: (rawFlags & 0x10) !== 0,
    attestedCredentialData: (rawFlags & 0x40) !== 0,
    extensionData: (rawFlags & 0x80) !== 0,
  };

  const result: ParsedAuthenticatorData = { rpIdHash, flags, signCount };

  if (flags.attestedCredentialData) {
    if (authData.length < 55) {
      throw new WebAuthnVerificationError(
        'INVALID_AUTH_DATA',
        'Attested credential data truncated.'
      );
    }
    const aaguidBytes = authData.slice(37, 53);
    const credIdLen = (authData[53] << 8) | authData[54];
    if (credIdLen === 0 || credIdLen > 1023 || 55 + credIdLen >= authData.length) {
      throw new WebAuthnVerificationError(
        'INVALID_AUTH_DATA',
        'Invalid attested credential ID length.'
      );
    }
    const credentialId = authData.slice(55, 55 + credIdLen);
    const coseStart = 55 + credIdLen;
    const coseDecoded = decodeCborPrefix(authData, coseStart);
    if (!(coseDecoded.value instanceof Map)) {
      throw new WebAuthnVerificationError(
        'INVALID_COSE_KEY',
        'Attested credential public key must be a CBOR map.'
      );
    }
    const coseMap = new Map<number, unknown>();
    for (const [k, v] of coseDecoded.value.entries()) {
      if (typeof k === 'number') {
        coseMap.set(k, v);
      }
    }
    result.attestedCredentialData = {
      aaguid: formatAaguid(aaguidBytes),
      credentialId,
      credentialPublicKeyCose: coseMap,
    };
  }

  return result;
}

export function verifyClientDataJson(
  clientDataJsonB64: string,
  expected: {
    type: 'webauthn.create' | 'webauthn.get';
    challenge: string;
    origin: string;
  }
): { rawBytes: Uint8Array; parsed: { type: string; challenge: string; origin: string; crossOrigin?: boolean } } {
  const rawBytes = base64UrlToBytes(clientDataJsonB64);
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(rawBytes);
    parsed = JSON.parse(text);
  } catch {
    throw new WebAuthnVerificationError('INVALID_CLIENT_DATA', 'Malformed clientDataJSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new WebAuthnVerificationError('INVALID_CLIENT_DATA', 'clientDataJSON must be an object.');
  }
  const cd = parsed as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };

  if (cd.type !== expected.type) {
    throw new WebAuthnVerificationError(
      'WRONG_CEREMONY_TYPE',
      `Unexpected WebAuthn ceremony type ${String(cd.type)}.`
    );
  }
  if (typeof cd.challenge !== 'string' || !constantTimeStringEqual(cd.challenge, expected.challenge)) {
    throw new WebAuthnVerificationError('CHALLENGE_MISMATCH', 'WebAuthn challenge mismatch.');
  }
  if (typeof cd.origin !== 'string' || cd.origin !== expected.origin) {
    throw new WebAuthnVerificationError(
      'ORIGIN_MISMATCH',
      `WebAuthn origin mismatch (expected ${expected.origin}).`
    );
  }
  if (cd.crossOrigin === true) {
    throw new WebAuthnVerificationError(
      'CROSS_ORIGIN_FORBIDDEN',
      'Cross-origin WebAuthn ceremonies are not permitted.'
    );
  }

  return {
    rawBytes,
    parsed: {
      type: expected.type,
      challenge: cd.challenge,
      origin: cd.origin,
      crossOrigin: typeof cd.crossOrigin === 'boolean' ? cd.crossOrigin : undefined,
    },
  };
}

export async function importWebAuthnPublicKey(
  spkiBytes: Uint8Array,
  coseAlgorithm: number
): Promise<CryptoKey> {
  const copy = new Uint8Array(spkiBytes.byteLength);
  copy.set(spkiBytes);
  if (coseAlgorithm === COSE_ALG_ES256) {
    return crypto.subtle.importKey(
      'spki',
      copy.buffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }
  if (coseAlgorithm === COSE_ALG_RS256) {
    return crypto.subtle.importKey(
      'spki',
      copy.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }
  throw new WebAuthnVerificationError(
    'UNSUPPORTED_ALGORITHM',
    `Unsupported stored algorithm ${coseAlgorithm}.`
  );
}

/**
 * Evaluates WebAuthn signature counter per W3C WebAuthn Level 2/3 §7.2 step 21:
 * - Synced passkeys (Apple iCloud Keychain, Google Password Manager, etc.) legitimately report 0 on every use.
 * - Hardware/roaming authenticators increment strictly monotonically. If either stored or incoming is > 0
 *   and incoming <= stored, treat as a potential cloned credential and reject.
 */
export function evaluateSignCount(storedSignCount: number, incomingSignCount: number): {
  valid: boolean;
  newSignCount: number;
  cloneSuspected: boolean;
} {
  if (storedSignCount === 0 && incomingSignCount === 0) {
    return { valid: true, newSignCount: 0, cloneSuspected: false };
  }
  if (incomingSignCount > storedSignCount) {
    return { valid: true, newSignCount: incomingSignCount, cloneSuspected: false };
  }
  return { valid: false, newSignCount: storedSignCount, cloneSuspected: true };
}

export async function verifyRegistrationResponse(input: {
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  transports?: string[];
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  requireUserVerification?: boolean;
}): Promise<VerifiedRegistrationResult> {
  verifyClientDataJson(input.clientDataJSON, {
    type: 'webauthn.create',
    challenge: input.expectedChallenge,
    origin: input.expectedOrigin,
  });

  const attestationBytes = base64UrlToBytes(input.attestationObject);
  const decoded = decodeCbor(attestationBytes);
  if (!(decoded instanceof Map)) {
    throw new WebAuthnVerificationError('INVALID_ATTESTATION', 'Attestation object must be a CBOR map.');
  }
  const authDataVal = decoded.get('authData');
  if (!(authDataVal instanceof Uint8Array)) {
    throw new WebAuthnVerificationError('INVALID_ATTESTATION', 'Attestation object missing authData.');
  }

  const parsedAuth = parseAuthenticatorData(authDataVal);
  const expectedRpIdHash = await sha256Bytes(input.expectedRpId);
  if (!constantTimeBytesEqual(parsedAuth.rpIdHash, expectedRpIdHash)) {
    throw new WebAuthnVerificationError('RP_ID_MISMATCH', 'Authenticator rpIdHash does not match RP ID.');
  }

  if (!parsedAuth.flags.userPresent) {
    throw new WebAuthnVerificationError('USER_NOT_PRESENT', 'Authenticator did not assert User Presence (UP).');
  }
  if (input.requireUserVerification !== false && !parsedAuth.flags.userVerified) {
    throw new WebAuthnVerificationError(
      'USER_NOT_VERIFIED',
      'Authenticator did not assert User Verification (UV).'
    );
  }
  if (!parsedAuth.flags.attestedCredentialData || !parsedAuth.attestedCredentialData) {
    throw new WebAuthnVerificationError(
      'MISSING_ATTESTED_CREDENTIAL',
      'Registration response missing attested credential data.'
    );
  }

  const attestedCredIdB64 = bytesToBase64Url(parsedAuth.attestedCredentialData.credentialId);
  if (!constantTimeStringEqual(attestedCredIdB64, input.credentialId)) {
    throw new WebAuthnVerificationError(
      'CREDENTIAL_ID_MISMATCH',
      'Submitted credential ID does not match attested credential data.'
    );
  }

  const { spkiBytes, algorithm } = cosePublicKeyToSpki(
    parsedAuth.attestedCredentialData.credentialPublicKeyCose
  );

  // Cryptographically validate the SPKI key by importing it through Web Crypto right now
  try {
    await importWebAuthnPublicKey(spkiBytes, algorithm);
  } catch {
    throw new WebAuthnVerificationError(
      'INVALID_PUBLIC_KEY',
      'Attested public key failed Web Crypto SPKI validation.'
    );
  }

  const allowedTransports = new Set(['usb', 'nfc', 'ble', 'hybrid', 'internal']);
  const transports = Array.isArray(input.transports)
    ? Array.from(
        new Set(
          input.transports.filter(
            (t): t is string => typeof t === 'string' && allowedTransports.has(t)
          )
        )
      )
    : [];

  return {
    credentialId: attestedCredIdB64,
    publicKeySpki: bytesToBase64Url(spkiBytes),
    coseAlgorithm: algorithm,
    signCount: parsedAuth.signCount,
    aaguid: parsedAuth.attestedCredentialData.aaguid,
    backupEligible: parsedAuth.flags.backupEligible,
    backupState: parsedAuth.flags.backupState,
    transports,
  };
}

export async function verifyAuthenticationResponse(input: {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  storedPublicKeySpki: string;
  storedCoseAlgorithm: number;
  storedSignCount: number;
  requireUserVerification?: boolean;
}): Promise<VerifiedAuthenticationResult> {
  const { rawBytes: clientDataRaw } = verifyClientDataJson(input.clientDataJSON, {
    type: 'webauthn.get',
    challenge: input.expectedChallenge,
    origin: input.expectedOrigin,
  });

  const authDataBytes = base64UrlToBytes(input.authenticatorData);
  const parsedAuth = parseAuthenticatorData(authDataBytes);

  const expectedRpIdHash = await sha256Bytes(input.expectedRpId);
  if (!constantTimeBytesEqual(parsedAuth.rpIdHash, expectedRpIdHash)) {
    throw new WebAuthnVerificationError('RP_ID_MISMATCH', 'Authenticator rpIdHash does not match RP ID.');
  }

  if (!parsedAuth.flags.userPresent) {
    throw new WebAuthnVerificationError('USER_NOT_PRESENT', 'Authenticator did not assert User Presence (UP).');
  }
  if (input.requireUserVerification !== false && !parsedAuth.flags.userVerified) {
    throw new WebAuthnVerificationError(
      'USER_NOT_VERIFIED',
      'Authenticator did not assert User Verification (UV).'
    );
  }

  const clientDataHash = await sha256Bytes(clientDataRaw);
  const signedData = concatBytes(authDataBytes, clientDataHash);
  const spkiBytes = base64UrlToBytes(input.storedPublicKeySpki);
  const signatureBytes = base64UrlToBytes(input.signature);

  const cryptoKey = await importWebAuthnPublicKey(spkiBytes, input.storedCoseAlgorithm);

  let verified = false;
  if (input.storedCoseAlgorithm === COSE_ALG_ES256) {
    const rawP1363Sig = derEcdsaSignatureToRawP1363(signatureBytes, 32);
    const sigBuf = new Uint8Array(rawP1363Sig.byteLength);
    sigBuf.set(rawP1363Sig);
    const dataBuf = new Uint8Array(signedData.byteLength);
    dataBuf.set(signedData);
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      sigBuf.buffer,
      dataBuf.buffer
    );
  } else if (input.storedCoseAlgorithm === COSE_ALG_RS256) {
    const sigBuf = new Uint8Array(signatureBytes.byteLength);
    sigBuf.set(signatureBytes);
    const dataBuf = new Uint8Array(signedData.byteLength);
    dataBuf.set(signedData);
    verified = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      cryptoKey,
      sigBuf.buffer,
      dataBuf.buffer
    );
  } else {
    throw new WebAuthnVerificationError(
      'UNSUPPORTED_ALGORITHM',
      `Unsupported stored algorithm ${input.storedCoseAlgorithm}.`
    );
  }

  if (!verified) {
    throw new WebAuthnVerificationError('INVALID_SIGNATURE', 'Passkey cryptographic signature verification failed.');
  }

  const signCountEval = evaluateSignCount(input.storedSignCount, parsedAuth.signCount);
  if (!signCountEval.valid) {
    throw new WebAuthnVerificationError(
      'CLONE_SUSPECTED',
      'Authenticator signature counter did not advance as expected; potential cloned credential.',
      true
    );
  }

  return {
    newSignCount: signCountEval.newSignCount,
    backupEligible: parsedAuth.flags.backupEligible,
    backupState: parsedAuth.flags.backupState,
  };
}
