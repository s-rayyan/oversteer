import { onSaveChanged } from '../game/cloudHook';
import { CLOUD_KEYS, mergeCloud, pickCloud } from '../game/cloudMerge';
import { reloadProfile } from '../game/profile';
import type { SaveData } from '../game/saveMerge';
import { decode, encode } from '../game/saveTransfer';
import { firebaseConfigured, getFirebase } from './firebase';
import { syncLocalBests } from './leaderboard';

// Optional accounts: a player can sign in with Google to keep their coins, cars and records online and use
// them on any device. Signing in LINKS the anonymous account they already have, so it keeps its id and every
// leaderboard score and replay stays theirs. Anonymous play keeps working exactly as before.

const LABEL_KEY = 'oversteer.accountLabel'; // shown on the title screen without waiting for Firebase
const BASE_KEY = 'oversteer.cloudBase'; // coin balance at the last sync with this account: { uid, coins }
const SYNCED_KEY = 'oversteer.cloudSyncedAt';
const DEBOUNCE_MS = 6000;

export interface Account {
  label: string;
}

const readLs = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const writeLs = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ }
};

/** Who is signed in on this device (instant: remembered from the last sign-in), or null. */
export function cachedAccount(): Account | null {
  const label = readLs(LABEL_KEY);
  return label ? { label } : null;
}

export const lastSyncedAt = (): number => Number(readLs(SYNCED_KEY)) || 0;

function readLocal(): SaveData {
  const out: SaveData = {};
  for (const k of CLOUD_KEYS) {
    const v = readLs(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

function readBase(uid: string): number {
  try {
    const b = JSON.parse(readLs(BASE_KEY) ?? 'null') as { uid?: string; coins?: number } | null;
    return b && b.uid === uid && typeof b.coins === 'number' ? b.coins : 0;
  } catch {
    return 0;
  }
}

let syncing: Promise<void> | null = null;
let again = false;

/**
 * Pulls the account's online save, merges it with this device's, and writes the result to both.
 * Safe to call at any time and as often as you like: it does nothing unless someone is signed in.
 */
export function syncCloud(): Promise<void> {
  if (!firebaseConfigured || !cachedAccount()) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      const { db, auth, fs } = await getFirebase();
      const user = auth.currentUser;
      if (!user || user.isAnonymous) return;
      const ref = fs.doc(db, 'users', user.uid);
      const snap = await fs.getDoc(ref);
      let cloud: SaveData | null = null;
      if (snap.exists()) cloud = (await decode(String(snap.data().data))).data;

      const { merged, coins } = mergeCloud(readLocal(), cloud, readBase(user.uid));
      for (const [k, v] of Object.entries(merged)) writeLs(k, v);
      writeLs(BASE_KEY, JSON.stringify({ uid: user.uid, coins }));
      reloadProfile();

      await fs.setDoc(ref, { v: 1, data: await encode({ id: 'cloud', data: pickCloud(merged) }), updatedAt: fs.serverTimestamp() });
      writeLs(SYNCED_KEY, String(Date.now()));
    } catch (e) {
      console.warn('[account sync]', e);
    }
  })().finally(() => {
    syncing = null;
    if (again) { again = false; void syncCloud(); }
  });
  return syncing;
}

/** Opens Google sign-in. Throws on failure; the error's `code` says why. */
export async function signInWithGoogle(): Promise<Account> {
  const { auth, authMod } = await getFirebase();
  const provider = new authMod.GoogleAuthProvider();
  const user = auth.currentUser!;
  try {
    if (user.isAnonymous) await authMod.linkWithPopup(user, provider);
    else await authMod.signInWithPopup(auth, provider);
  } catch (e) {
    // This Google account already has an online save (from another device): switch to it. This device's own
    // progress is merged into that account below.
    if ((e as { code?: string }).code !== 'auth/credential-already-in-use') throw e;
    const cred = authMod.GoogleAuthProvider.credentialFromError(e as Parameters<typeof authMod.GoogleAuthProvider.credentialFromError>[0]);
    if (!cred) throw e;
    await authMod.signInWithCredential(auth, cred);
  }
  const me = auth.currentUser!;
  await me.getIdToken(true); // the security rules need the new sign-in method in the token
  const label = me.email ?? me.displayName ?? 'Google account';
  writeLs(LABEL_KEY, label);
  await syncCloud();
  void syncLocalBests(); // post any runs from this device that are still waiting to upload
  return { label };
}

/** Signs out of the account. This device keeps its progress and goes back to being an anonymous player. */
export async function signOutAccount(): Promise<void> {
  const { auth, authMod } = await getFirebase();
  await authMod.signOut(auth);
  await authMod.signInAnonymously(auth);
  writeLs(LABEL_KEY, null);
  writeLs(BASE_KEY, null);
  writeLs(SYNCED_KEY, null);
}

/** Call once at startup: keeps a signed-in player's save in step with their account. */
export function initAccountSync(): void {
  if (!firebaseConfigured) return;
  let timer: number | undefined;
  onSaveChanged(() => {
    if (!cachedAccount()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncCloud(), DEBOUNCE_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cachedAccount()) void syncCloud();
  });
  window.addEventListener('online', () => void syncCloud());
  void syncCloud();
}

/** A short explanation for a sign-in error. Returns null when the player just closed the popup. */
export function describeAuthError(e: unknown): string | null {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is not turned on for this game yet.';
  if (code === 'auth/unauthorized-domain') return 'Sign-in is not allowed from this web address yet.';
  if (code === 'auth/network-request-failed') return 'No connection. Try again when you are online.';
  return `Sign-in failed (${code.replace('auth/', '') || 'unknown error'}).`;
}
