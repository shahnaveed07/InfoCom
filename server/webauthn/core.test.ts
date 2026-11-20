import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COSE_ALG_ES256,
  COSE_ALG_RS256,
  WebAuthnVerificationError,
  base64UrlToBytes,
  bytesToBase64Url,
  evaluateSignCount,
  generateChallengeBase64Url,
  sha256Bytes,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from './core.ts';

// Minimal deterministic CBOR encoder for test-only synthetic authenticators
function encodeCborUint(major: number, n: number): Uint8Array {
  const prefix = major << 5;
  if (n < 24) return new Uint8Array([prefix | n]);
  if (n < 256) return new Uint8Array([prefix | 24, n]);
  if (n < 65536) return new Uint8Array([prefix | 25, n >> 8, n & 0xff]);
  return new Uint8Array([
    prefix | 26,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

function encodeCborValue(val: unknown): Uint8Array {
  if (typeof val === 'number') {
    if (val >= 0) return encodeCborUint(0, val);
    return encodeCborUint(1, -1 - val);
  }
  if (val instanceof Uint8Array) {
    const hdr = encodeCborUint(2, val.length);
    const out = new Uint8Array(hdr.length + val.length);
    out.set(hdr, 0);
    out.set(val, hdr.length);
    return out;
  }
  if (typeof val === 'string') {
    const bytes = new TextEncoder().encode(val);
    const hdr = encodeCborUint(3, bytes.length);
    const out = new Uint8Array(hdr.length + bytes.length);
    out.set(hdr, 0);
    out.set(bytes, hdr.length);
    return out;
  }
  if (val instanceof Map) {
    const chunks: Uint8Array[] = [encodeCborUint(5, val.size)];
    for (const [k, v] of val.entries()) {
      chunks.push(encodeCborValue(k), encodeCborValue(v));
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
  throw new Error(`Unsupported CBOR test value: ${typeof val}`);
}

function rawP1363ToDerEcdsa(raw: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.subarray(start);
    const needPad = (trimmed[0] & 0x80) !== 0;
    const out = new Uint8Array(2 + trimmed.length + (needPad ? 1 : 0));
    out[0] = 0x02;
    out[1] = trimmed.length + (needPad ? 1 : 0);
    if (needPad) {
      out[2] = 0x00;
      out.set(trimmed, 3);
    } else {
      out.set(trimmed, 2);
    }
    return out;
  };
  const r = encodeInt(raw.subarray(0, 32));
  const s = encodeInt(raw.subarray(32, 64));
  const seq = new Uint8Array(2 + r.length + s.length);
  seq[0] = 0x30;
  seq[1] = r.length + s.length;
  seq.set(r, 2);
  seq.set(s, 2 + r.length);
  return seq;
}

async function createSyntheticAuthenticator(alg: typeof COSE_ALG_ES256 | typeof COSE_ALG_RS256) {
  const credIdBytes = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = bytesToBase64Url(credIdBytes);

  let keyPair: CryptoKeyPair;
  let coseKey: Map<number, unknown>;

  if (alg === COSE_ALG_ES256) {
    keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    coseKey = new Map<number, unknown>([
      [1, 2],
      [3, COSE_ALG_ES256],
      [-1, 1],
      [-2, base64UrlToBytes(jwk.x!)],
      [-3, base64UrlToBytes(jwk.y!)],
    ]);
  } else {
    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    coseKey = new Map<number, unknown>([
      [1, 3],
      [3, COSE_ALG_RS256],
      [-1, base64UrlToBytes(jwk.n!)],
      [-2, base64UrlToBytes(jwk.e!)],
    ]);
  }

  return {
    credentialId,
    credIdBytes,
    keyPair,
    coseKey,
    async makeRegistration(opts: {
      challenge: string;
      origin: string;
      rpId: string;
      flags?: number;
      signCount?: number;
      crossOrigin?: boolean;
      type?: string;
    }) {
      const rpIdHash = await sha256Bytes(opts.rpId);
      const flags = opts.flags ?? 0x45; // UP | UV | AT
      const aaguid = new Uint8Array(16);
      const coseBytes = encodeCborValue(coseKey);
      const authData = new Uint8Array(37 + 16 + 2 + credIdBytes.length + coseBytes.length);
      authData.set(rpIdHash, 0);
      authData[32] = flags;
      new DataView(authData.buffer).setUint32(33, opts.signCount ?? 0, false);
      authData.set(aaguid, 37);
      authData[53] = (credIdBytes.length >> 8) & 0xff;
      authData[54] = credIdBytes.length & 0xff;
      authData.set(credIdBytes, 55);
      authData.set(coseBytes, 55 + credIdBytes.length);

      const attObj = encodeCborValue(
        new Map<unknown, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );
      const clientDataJsonBytes = new TextEncoder().encode(
        JSON.stringify({
          type: opts.type ?? 'webauthn.create',
          challenge: opts.challenge,
          origin: opts.origin,
          crossOrigin: opts.crossOrigin ?? false,
        })
      );
      return {
        credentialId,
        clientDataJSON: bytesToBase64Url(clientDataJsonBytes),
        attestationObject: bytesToBase64Url(attObj),
        transports: ['internal', 'hybrid'],
      };
    },
    async makeAssertion(opts: {
      challenge: string;
      origin: string;
      rpId: string;
      flags?: number;
      signCount?: number;
      crossOrigin?: boolean;
      type?: string;
      tamperSignature?: boolean;
    }) {
      const rpIdHash = await sha256Bytes(opts.rpId);
      const authData = new Uint8Array(37);
      authData.set(rpIdHash, 0);
      authData[32] = opts.flags ?? 0x05; // UP | UV
      new DataView(authData.buffer).setUint32(33, opts.signCount ?? 0, false);

      const clientDataBytes = new TextEncoder().encode(
        JSON.stringify({
          type: opts.type ?? 'webauthn.get',
          challenge: opts.challenge,
          origin: opts.origin,
          crossOrigin: opts.crossOrigin ?? false,
        })
      );
      const clientDataHash = await sha256Bytes(clientDataBytes);
      const signedPayload = new Uint8Array(authData.length + clientDataHash.length);
      signedPayload.set(authData, 0);
      signedPayload.set(clientDataHash, authData.length);

      let sigBytes: Uint8Array;
      if (alg === COSE_ALG_ES256) {
        const rawSig = new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            keyPair.privateKey,
            signedPayload
          )
        );
        if (opts.tamperSignature) rawSig[0] ^= 0xff;
        sigBytes = rawP1363ToDerEcdsa(rawSig);
      } else {
        sigBytes = new Uint8Array(
          await crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyPair.privateKey,
            signedPayload
          )
        );
        if (opts.tamperSignature) sigBytes[0] ^= 0xff;
      }

      return {
        clientDataJSON: bytesToBase64Url(clientDataBytes),
        authenticatorData: bytesToBase64Url(authData),
        signature: bytesToBase64Url(sigBytes),
      };
    },
  };
}

test('ES256 passkey registration + authentication succeeds and runs well under 10 ms CPU', async () => {
  const origin = 'https://igs-infocom-ams-worker.example.workers.dev';
  const rpId = 'igs-infocom-ams-worker.example.workers.dev';
  const auth = await createSyntheticAuthenticator(COSE_ALG_ES256);

  const regChallenge = generateChallengeBase64Url();
  const regPayload = await auth.makeRegistration({
    challenge: regChallenge,
    origin,
    rpId,
    flags: 0x5d, // UP | UV | BE | BS | AT (synced passkey)
    signCount: 0,
  });

  const regStart = performance.now();
  const verifiedReg = await verifyRegistrationResponse({
    ...regPayload,
    expectedChallenge: regChallenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
  });
  const regElapsedMs = performance.now() - regStart;

  assert.equal(verifiedReg.credentialId, auth.credentialId);
  assert.equal(verifiedReg.coseAlgorithm, COSE_ALG_ES256);
  assert.equal(verifiedReg.backupEligible, true);
  assert.equal(verifiedReg.backupState, true);
  assert.deepEqual(verifiedReg.transports, ['internal', 'hybrid']);

  // Synced passkey authentication with signCount 0 -> 0 must succeed
  const loginChallenge = generateChallengeBase64Url();
  const assertion = await auth.makeAssertion({
    challenge: loginChallenge,
    origin,
    rpId,
    flags: 0x1d, // UP | UV | BE | BS
    signCount: 0,
  });

  const loginStart = performance.now();
  const verifiedLogin = await verifyAuthenticationResponse({
    ...assertion,
    expectedChallenge: loginChallenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
    storedPublicKeySpki: verifiedReg.publicKeySpki,
    storedCoseAlgorithm: verifiedReg.coseAlgorithm,
    storedSignCount: verifiedReg.signCount,
  });
  const loginElapsedMs = performance.now() - loginStart;

  assert.equal(verifiedLogin.newSignCount, 0);
  assert.ok(
    regElapsedMs < 50 && loginElapsedMs < 50,
    `Expected fast Web Crypto verification (reg=${regElapsedMs.toFixed(2)}ms, login=${loginElapsedMs.toFixed(2)}ms)`
  );
});

test('RS256 passkey registration + authentication succeeds with monotonic signCount', async () => {
  const origin = 'http://127.0.0.1:8787';
  const rpId = '127.0.0.1';
  const auth = await createSyntheticAuthenticator(COSE_ALG_RS256);

  const regChallenge = generateChallengeBase64Url();
  const regPayload = await auth.makeRegistration({
    challenge: regChallenge,
    origin,
    rpId,
    signCount: 1,
  });
  const verifiedReg = await verifyRegistrationResponse({
    ...regPayload,
    expectedChallenge: regChallenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
  });
  assert.equal(verifiedReg.coseAlgorithm, COSE_ALG_RS256);
  assert.equal(verifiedReg.signCount, 1);

  const loginChallenge = generateChallengeBase64Url();
  const assertion = await auth.makeAssertion({
    challenge: loginChallenge,
    origin,
    rpId,
    signCount: 2,
  });
  const verifiedLogin = await verifyAuthenticationResponse({
    ...assertion,
    expectedChallenge: loginChallenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
    storedPublicKeySpki: verifiedReg.publicKeySpki,
    storedCoseAlgorithm: verifiedReg.coseAlgorithm,
    storedSignCount: verifiedReg.signCount,
  });
  assert.equal(verifiedLogin.newSignCount, 2);
});

test('WebAuthn negative security checks reject bad signature, wrong RP ID, wrong origin, wrong challenge, missing UV, crossOrigin, and clone regression', async () => {
  const origin = 'https://igs-infocom-ams-worker.example.workers.dev';
  const rpId = 'igs-infocom-ams-worker.example.workers.dev';
  const auth = await createSyntheticAuthenticator(COSE_ALG_ES256);

  const regChallenge = generateChallengeBase64Url();
  const regPayload = await auth.makeRegistration({
    challenge: regChallenge,
    origin,
    rpId,
    signCount: 5,
  });
  const verifiedReg = await verifyRegistrationResponse({
    ...regPayload,
    expectedChallenge: regChallenge,
    expectedOrigin: origin,
    expectedRpId: rpId,
  });

  // 1. Tampered signature
  const ch1 = generateChallengeBase64Url();
  const badSig = await auth.makeAssertion({
    challenge: ch1,
    origin,
    rpId,
    signCount: 6,
    tamperSignature: true,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...badSig,
      expectedChallenge: ch1,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) => err instanceof WebAuthnVerificationError && err.code === 'INVALID_SIGNATURE'
  );

  // 2. Wrong RP ID
  const ch2 = generateChallengeBase64Url();
  const wrongRp = await auth.makeAssertion({
    challenge: ch2,
    origin,
    rpId: 'evil.example.com',
    signCount: 6,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...wrongRp,
      expectedChallenge: ch2,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) => err instanceof WebAuthnVerificationError && err.code === 'RP_ID_MISMATCH'
  );

  // 3. Wrong Origin
  const ch3 = generateChallengeBase64Url();
  const wrongOrigin = await auth.makeAssertion({
    challenge: ch3,
    origin: 'https://phishing.workers.dev',
    rpId,
    signCount: 6,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...wrongOrigin,
      expectedChallenge: ch3,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) => err instanceof WebAuthnVerificationError && err.code === 'ORIGIN_MISMATCH'
  );

  // 4. Cross-origin iframe attempt
  const ch4 = generateChallengeBase64Url();
  const crossOrig = await auth.makeAssertion({
    challenge: ch4,
    origin,
    rpId,
    signCount: 6,
    crossOrigin: true,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...crossOrig,
      expectedChallenge: ch4,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) =>
      err instanceof WebAuthnVerificationError && err.code === 'CROSS_ORIGIN_FORBIDDEN'
  );

  // 5. Missing User Verification (UV)
  const ch5 = generateChallengeBase64Url();
  const noUv = await auth.makeAssertion({
    challenge: ch5,
    origin,
    rpId,
    flags: 0x01, // UP only, no UV
    signCount: 6,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...noUv,
      expectedChallenge: ch5,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) => err instanceof WebAuthnVerificationError && err.code === 'USER_NOT_VERIFIED'
  );

  // 6. Wrong ceremony type (passing webauthn.create into login verify)
  const ch6 = generateChallengeBase64Url();
  const wrongType = await auth.makeAssertion({
    challenge: ch6,
    origin,
    rpId,
    signCount: 6,
    type: 'webauthn.create',
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...wrongType,
      expectedChallenge: ch6,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) => err instanceof WebAuthnVerificationError && err.code === 'WRONG_CEREMONY_TYPE'
  );

  // 7. Clone counter regression (stored=5, incoming=5 or incoming=3)
  const ch7 = generateChallengeBase64Url();
  const cloneAssertion = await auth.makeAssertion({
    challenge: ch7,
    origin,
    rpId,
    signCount: 5,
  });
  await assert.rejects(
    verifyAuthenticationResponse({
      ...cloneAssertion,
      expectedChallenge: ch7,
      expectedOrigin: origin,
      expectedRpId: rpId,
      storedPublicKeySpki: verifiedReg.publicKeySpki,
      storedCoseAlgorithm: verifiedReg.coseAlgorithm,
      storedSignCount: 5,
    }),
    (err: unknown) =>
      err instanceof WebAuthnVerificationError &&
      err.code === 'CLONE_SUSPECTED' &&
      err.cloneSuspected === true
  );

  // 8. Sign count policy unit checks
  assert.equal(evaluateSignCount(0, 0).valid, true);
  assert.equal(evaluateSignCount(0, 1).valid, true);
  assert.equal(evaluateSignCount(10, 11).valid, true);
  assert.equal(evaluateSignCount(10, 10).cloneSuspected, true);
  assert.equal(evaluateSignCount(10, 0).cloneSuspected, true);
});
