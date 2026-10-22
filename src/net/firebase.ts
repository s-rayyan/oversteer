import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Database } from 'firebase/database';
import type { Firestore } from 'firebase/firestore';

type FirestoreModule = typeof import('firebase/firestore');
type AuthModule = typeof import('firebase/auth');
type DatabaseModule = typeof import('firebase/database');

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  /** Optional: the Realtime Database URL. When set, live race positions go there instead of Firestore. */
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
};

export const realtimeConfigured = Boolean(cfg.databaseURL);

/** False until the four VITE_FIREBASE_* values are present; the game then runs local-only. */
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

export interface FirebaseCtx {
  app: FirebaseApp;
  db: Firestore;
  /** The signed-in user's id. Read fresh each time: it changes when the player signs in to an account. */
  readonly uid: string;
  fs: FirestoreModule;
  auth: Auth;
  authMod: AuthModule;
}

let ctx: Promise<FirebaseCtx> | null = null;

/** Lazily loads the SDK (separate chunk) and signs in anonymously so scores are tied to a stable uid. */
export function getFirebase(): Promise<FirebaseCtx> {
  if (!firebaseConfigured) return Promise.reject(new Error('Firebase is not configured'));
  ctx ??= (async () => {
    const [{ initializeApp }, authMod, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    const app = initializeApp(cfg);
    const auth = authMod.getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    return { app, db: fs.getFirestore(app), get uid() { return auth.currentUser!.uid; }, fs, auth, authMod };
  })().catch((e) => {
    ctx = null; // allow a retry
    throw e;
  });
  return ctx;
}

export interface RealtimeCtx {
  rtdb: Database;
  rt: DatabaseModule;
  readonly uid: string;
}

let rtCtx: Promise<RealtimeCtx> | null = null;

/** Lazily loads the Realtime Database SDK (its own chunk), used for the high-rate race positions. */
export function getRealtime(): Promise<RealtimeCtx> {
  if (!realtimeConfigured) return Promise.reject(new Error('Realtime Database is not configured'));
  rtCtx ??= (async () => {
    const [base, rt] = await Promise.all([getFirebase(), import('firebase/database')]);
    return { rtdb: rt.getDatabase(base.app), rt, get uid() { return base.uid; } };
  })().catch((e) => {
    rtCtx = null; // allow a retry
    throw e;
  });
  return rtCtx;
}
