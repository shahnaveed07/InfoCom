// Browser WebAuthn (Passkeys) client helpers using standard navigator.credentials APIs.

export interface SerializedCreationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: Array<{
    type: 'public-key';
    id: string;
    transports?: AuthenticatorTransport[];
  }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
}

export interface SerializedRequestOptions {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{
    type: 'public-key';
    id: string;
    transports?: AuthenticatorTransport[];
  }>;
}

export function isBrowserWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials) &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function'
  );
}

export function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  const binary = atob(normalized + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createPasskeyCredential(options: SerializedCreationOptions): Promise<{
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  transports: string[];
}> {
  if (!isBrowserWebAuthnSupported()) {
    throw new Error(
      'This browser does not support WebAuthn passkeys. Use a modern Chrome, Safari, Edge, or Firefox browser.'
    );
  }

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToArrayBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64UrlToArrayBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout ?? 120000,
    attestation: options.attestation ?? 'none',
    authenticatorSelection: options.authenticatorSelection ?? {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: (options.excludeCredentials ?? []).map((cred) => ({
      type: 'public-key',
      id: base64UrlToArrayBuffer(cred.id),
      transports: cred.transports,
    })),
  };

  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey registration was cancelled or returned no credential.');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === 'function' ? response.getTransports() : [];

  return {
    credentialId: arrayBufferToBase64Url(credential.rawId),
    clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
    attestationObject: arrayBufferToBase64Url(response.attestationObject),
    transports,
  };
}

export async function getPasskeyAssertion(options: SerializedRequestOptions): Promise<{
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}> {
  if (!isBrowserWebAuthnSupported()) {
    throw new Error(
      'This browser does not support WebAuthn passkeys. Use a modern Chrome, Safari, Edge, or Firefox browser.'
    );
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToArrayBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout ?? 120000,
    userVerification: options.userVerification ?? 'required',
    ...(options.allowCredentials && options.allowCredentials.length > 0
      ? {
          allowCredentials: options.allowCredentials.map((cred) => ({
            type: 'public-key',
            id: base64UrlToArrayBuffer(cred.id),
            transports: cred.transports,
          })),
        }
      : {}),
  };

  const credential = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey sign-in was cancelled.');
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    credentialId: arrayBufferToBase64Url(credential.rawId),
    clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
    authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
    signature: arrayBufferToBase64Url(response.signature),
  };
}

export function formatWebAuthnError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'AbortError':
        return 'Passkey prompt was cancelled or timed out. Click the button again to retry.';
      case 'InvalidStateError':
        return 'This authenticator already has a passkey registered for this account.';
      case 'NotSupportedError':
        return 'Your authenticator does not support the required cryptographic algorithm (ES256/RS256).';
      case 'SecurityError':
        return 'Passkey verification failed due to an invalid domain or insecure context (HTTPS required).';
      default:
        return err.message || 'Passkey operation failed.';
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Passkey operation failed.';
}
