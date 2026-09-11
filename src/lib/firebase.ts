import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getRuntimeEnv } from './runtimeConfig';

export const firebaseConfig = {
  apiKey: getRuntimeEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getRuntimeEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getRuntimeEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getRuntimeEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getRuntimeEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getRuntimeEnv('VITE_FIREBASE_APP_ID'),
};

const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const;

export const missingFirebaseConfigKeys = requiredConfigKeys.filter(
  (key) => !firebaseConfig[key],
);

export const isFirebaseConfigured = missingFirebaseConfigKeys.length === 0;

if (!isFirebaseConfigured) {
  console.warn(
    `Firebase is not configured yet. Missing: ${missingFirebaseConfigKeys.join(', ')}`,
  );
}

export const firebaseApp: FirebaseApp | null = isFirebaseConfigured
  ? initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const app = firebaseApp;
export const auth = firebaseAuth;
