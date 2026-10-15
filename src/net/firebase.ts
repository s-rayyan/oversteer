import type { Firestore } from 'firebase/firestore';

type FirestoreModule = typeof import('firebase/firestore');

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** False until the four VITE_FIREBASE_* values are present; the game then runs local-only. */
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

export interface FirebaseCtx {
  db: Firestore;
  uid: string;
  fs: FirestoreModule;
}

let ctx: Promise<FirebaseCtx> | null = null;

/** Lazily loads the SDK (separate chunk) and signs in anonymously so scores are tied to a stable uid. */
export function getFirebase(): Promise<FirebaseCtx> {
  if (!firebaseConfigured) return Promise.reject(new Error('Firebase is not configured'));
  ctx ??= (async () => {
    const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    await auth.authStateReady();
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    return { db: fs.getFirestore(app), uid: user.uid, fs };
  })().catch((e) => {
    ctx = null; // allow a retry
    throw e;
  });
  return ctx;
}
