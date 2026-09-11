import { createHash } from 'node:crypto';
import {
  DocumentReference,
  GeoPoint,
  Timestamp,
} from 'firebase-admin/firestore';

type JsonObject = Record<string, unknown>;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

export const encodeFirestoreSourceValue = (value: unknown): unknown => {
  if (value === null) return null;
  if (value === undefined) return { __firestore_type: 'undefined' };
  if (value instanceof Timestamp) {
    return {
      __firestore_type: 'timestamp',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
      iso: value.toDate().toISOString(),
    };
  }
  if (value instanceof Date) {
    return { __firestore_type: 'date', iso: value.toISOString() };
  }
  if (value instanceof GeoPoint) {
    return {
      __firestore_type: 'geopoint',
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (value instanceof DocumentReference) {
    return { __firestore_type: 'reference', path: value.path };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      __firestore_type: 'bytes',
      base64: Buffer.from(value).toString('base64'),
    };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { __firestore_type: 'number', value: String(value) };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreSourceValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, entry]) => [
        key,
        encodeFirestoreSourceValue(entry),
      ]),
    );
  }
  return value;
};

export const encodeFirestoreRuntimeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof DocumentReference) return value.path;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Array.isArray(value)) return value.map(encodeFirestoreRuntimeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, encodeFirestoreRuntimeValue(entry)]),
    );
  }
  return value;
};

export const hashFirestoreSourceValue = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(stableValue(value)))
  .digest('hex');
