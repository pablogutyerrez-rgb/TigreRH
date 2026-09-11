import './firebaseAdminApp.js';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

export const adminAuth = getAuth();
export const adminStorage = getStorage();
