import './firebaseAdminApp.js';
import { getFirestore } from 'firebase-admin/firestore';

export const adminDb = getFirestore();
adminDb.settings({
  preferRest: true,
  ignoreUndefinedProperties: true,
});
