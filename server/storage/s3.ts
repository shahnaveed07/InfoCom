import crypto from 'node:crypto';

interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getS3Config(): S3Config {
  const endpoint = (process.env.STORAGE_S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  const bucket = (process.env.STORAGE_S3_BUCKET || '').trim();
  const region = (process.env.STORAGE_S3_REGION || 'us-east-1').trim();
  const accessKeyId = (process.env.STORAGE_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.STORAGE_S3_SECRET_ACCESS_KEY || '').trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3-compatible storage requires STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, and STORAGE_S3_SECRET_ACCESS_KEY.'
    );
  }
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function signS3Request(params: {
  method: 'GET' | 'PUT' | 'DELETE';
  storageKey: string;
  payload: Buffer | string;
  contentType?: string;
}): { url: string; headers: Record<string, string> } {
  const cfg = getS3Config();
  const cleanKey = params.storageKey.replace(/^\/+/, '');
  const baseUrl = new URL(`${cfg.endpoint}/${cfg.bucket}/${cleanKey}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.payload);

  const canonicalHeadersList: Array<[string, string]> = [
    ['host', baseUrl.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ];
  if (params.contentType) {
    canonicalHeadersList.push(['content-type', params.contentType]);
  }
  canonicalHeadersList.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = canonicalHeadersList.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = canonicalHeadersList.map(([k]) => k).join(';');
  const canonicalRequest = [
    params.method,
    baseUrl.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: authorization,
  };
  if (params.contentType) {
    headers['content-type'] = params.contentType;
  }
  return { url: baseUrl.toString(), headers };
}

export async function writeS3Object(
  storageKey: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const { url, headers } = signS3Request({
    method: 'PUT',
    storageKey,
    payload: buffer,
    contentType,
  });
  const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(buffer) });
  if (!res.ok) {
    throw new Error(`S3 upload failed (${res.status}).`);
  }
}

export async function readS3Object(storageKey: string): Promise<Buffer> {
  const { url, headers } = signS3Request({
    method: 'GET',
    storageKey,
    payload: '',
  });
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`S3 read failed (${res.status}).`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

export async function deleteS3Object(storageKey: string): Promise<void> {
  const { url, headers } = signS3Request({
    method: 'DELETE',
    storageKey,
    payload: '',
  });
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 delete failed (${res.status}).`);
  }
}
