import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { argon2Verify, argon2id } from 'hash-wasm';
import { hashPassword, verifyPassword } from './auth.ts';

test('hash-wasm Argon2id (m=19456, t=2, p=1) is 100% PHC interoperable with native argon2 and exceeds 10ms Free CPU budget', async () => {
  const password = 'IGS-Sopore-Benchmark!2026';
  const nativeHash = await hashPassword(password);

  assert.equal(
    nativeHash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'),
    true
  );

  // Verify native Argon2id hash using pure WASM implementation
  const wasmVerifiesNative = await argon2Verify({
    password,
    hash: nativeHash,
  });
  assert.equal(wasmVerifiesNative, true);

  // Generate WASM Argon2id hash with identical OWASP cost parameters and verify via native argon2
  const salt = crypto.randomBytes(16);
  const wasmStart = performance.now();
  const wasmHash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
  const wasmHashMs = performance.now() - wasmStart;

  const nativeVerification = await verifyPassword(password, wasmHash);
  assert.deepEqual(nativeVerification, { valid: true, needsRehash: false });

  // Verify timing against Cloudflare Workers Free 10 ms CPU ceiling
  const verifyStart = performance.now();
  const verifyOk = await argon2Verify({ password, hash: nativeHash });
  const wasmVerifyMs = performance.now() - verifyStart;

  assert.equal(verifyOk, true);
  assert.ok(
    wasmHashMs > 10 && wasmVerifyMs > 10,
    `Expected OWASP Argon2id WASM hashing (${wasmHashMs.toFixed(1)}ms) and verification (${wasmVerifyMs.toFixed(1)}ms) to exceed Cloudflare Workers Free 10ms CPU limit without weakening m=19456,t=2,p=1.`
  );
});
