import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';

const normalizeEnvValue = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.trim();
};

const privateKey = normalizeEnvValue(process.env.FIREBASE_PRIVATE_KEY)
  ?.replace(/\\n/g, '\n')
  .replace(/\r/g, '');
const projectId = normalizeEnvValue(process.env.FIREBASE_PROJECT_ID);
const clientEmail = normalizeEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
const storageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;

if (!getApps().length) {
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin environment variables.');
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}
