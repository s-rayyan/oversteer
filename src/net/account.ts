import { onSaveChanged } from '../game/cloudHook';
import { CLOUD_KEYS, coinsOf, mergeCloud, pickCloud } from '../game/cloudMerge';
import { reloadProfile } from '../game/profile';
import type { SaveData } from '../game/saveMerge';
import { decode, encode } from '../game/saveTransfer';
import { firebaseConfigured, getFirebase } from './firebase';
import { syncLocalBests } from './leaderboard';

// Accounts: a player signs in (Google, email and password, or an emailed link) to keep their coins, cars and records online and use
// them on any device. Signing in LINKS the anonymous account they already have, so it keeps its id and every
// leaderboard score and replay stays theirs. Anonymous play keeps working exactly as before.

const LABEL_KEY = 'oversteer.accountLabel'; // shown on the title screen without waiting for Firebase
const BASE_KEY = 'oversteer.cloudBase'; // coin balance at the last sync with this account: { uid, coins }
const SYNCED_KEY = 'oversteer.cloudSyncedAt';
const DEBOUNCE_MS = 6000;
/**
 * Mid-race the save changes every few seconds (coins are autosaved), and every sync is a read and a write. Sync at
 * most this often while playing; leaving the page or hiding the tab still saves straight away.
 */
const MIN_INTERVAL_MS = 120_000;

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
      // A transaction, so two devices syncing at the same moment can't overwrite each other's coins: if the online
      // save changes between our read and our write, Firestore runs this again with the new one.
      let coins = 0;
      await fs.runTransaction(db, async (t) => {
        const snap = await t.get(ref);
        const cloud: SaveData | null = snap.exists() ? (await decode(String(snap.data().data))).data : null;
        const cloudData = cloud ? JSON.stringify(pickCloud(cloud)) : null;

        // Read this device's save only now, after every await, so coins earned while the online save was loading
        // are in it; then write the result straight back, with no await in between.
        const result = mergeCloud(readLocal(), cloud, readBase(user.uid));
        coins = result.coins;
        for (const [k, v] of Object.entries(result.merged)) writeLs(k, v);
        reloadProfile();
        // The device now holds the online coins, but the online save doesn't yet hold the device's. Until the write
        // below succeeds, record the online balance as the base: if it fails (or this runs again), the next merge
        // adds this device's coins on top of the online save exactly once instead of dropping or doubling them.
        writeLs(BASE_KEY, JSON.stringify({ uid: user.uid, coins: cloud ? coinsOf(cloud) : 0 }));

        // Nothing new on either side: skip the write (it costs quota and changes nothing).
        if (cloudData === JSON.stringify(result.merged)) return;
        t.set(ref, { v: 1, data: await encode({ id: 'cloud', data: result.merged }), updatedAt: fs.serverTimestamp() });
      });
      writeLs(BASE_KEY, JSON.stringify({ uid: user.uid, coins }));
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

/** Runs after any successful sign-in: refreshes the token, remembers who it is, merges the save, tells the page. */
async function finishSignIn(): Promise<Account> {
  const { auth } = await getFirebase();
  const me = auth.currentUser!;
  await me.getIdToken(true); // the security rules need the new sign-in method in the token
  const label = me.email ?? me.displayName ?? 'Account';
  writeLs(LABEL_KEY, label);
  await syncCloud();
  void syncLocalBests(); // post any runs from this device that are still waiting to upload
  window.dispatchEvent(new Event(SIGNED_IN_EVENT));
  return { label };
}

/** Fired on `window` whenever someone signs in (including by clicking an emailed link in another tab load). */
export const SIGNED_IN_EVENT = 'oversteer-signed-in';

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
  return finishSignIn();
}

/**
 * Email and password. `create` makes a new account (upgrading the anonymous player, so progress and scores carry
 * over); otherwise it signs in to an existing one and this device's progress is merged into it.
 */
export async function signInWithPassword(email: string, password: string, create: boolean): Promise<Account> {
  const { auth, authMod } = await getFirebase();
  const user = auth.currentUser!;
  if (!create) await authMod.signInWithEmailAndPassword(auth, email, password);
  else if (user.isAnonymous) await authMod.linkWithCredential(user, authMod.EmailAuthProvider.credential(email, password));
  else await authMod.createUserWithEmailAndPassword(auth, email, password);
  return finishSignIn();
}

// Not under the `oversteer.` prefix: that's the save, and this is only needed until the emailed link is opened.
const EMAIL_LINK_KEY = 'oversteerEmailForSignIn';

/** Passwordless sign-in: emails a one-time link that signs the player in (and creates the account if new). */
export async function sendEmailLink(email: string): Promise<void> {
  const { auth, authMod } = await getFirebase();
  await authMod.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
  writeLs(EMAIL_LINK_KEY, email);
}

/** Call at startup: if the page was opened from an emailed sign-in link, finishes signing in. Returns null otherwise. */
export async function completeEmailLinkSignIn(): Promise<Account | null> {
  if (!firebaseConfigured || !/[?&]oobCode=/.test(location.search)) return null;
  const { auth, authMod } = await getFirebase();
  const href = location.href;
  if (!authMod.isSignInWithEmailLink(auth, href)) return null;
  // Opened on a different device or browser from the one that asked for the link: the address has to be typed again.
  const email = readLs(EMAIL_LINK_KEY) ?? window.prompt('Confirm your email address to finish signing in')?.trim();
  if (!email) return null;
  const user = auth.currentUser!;
  try {
    if (user.isAnonymous) await authMod.linkWithCredential(user, authMod.EmailAuthProvider.credentialWithLink(email, href));
    else await authMod.signInWithEmailLink(auth, email, href);
  } catch (e) {
    // This email already has an account: switch to it (this device's progress is merged in below).
    const code = (e as { code?: string }).code;
    if (code !== 'auth/email-already-in-use' && code !== 'auth/credential-already-in-use') throw e;
    await authMod.signInWithEmailLink(auth, email, href);
  }
  writeLs(EMAIL_LINK_KEY, null);
  history.replaceState(null, '', location.pathname); // drop the one-time code from the address bar
  return finishSignIn();
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
  let dirty = false;
  onSaveChanged(() => {
    dirty = true;
    if (!cachedAccount() || timer !== undefined) return; // a sync is already booked: it will pick this change up
    const wait = Math.max(DEBOUNCE_MS, lastSyncedAt() + MIN_INTERVAL_MS - Date.now());
    timer = window.setTimeout(() => {
      timer = undefined;
      dirty = false;
      void syncCloud();
    }, wait);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cachedAccount() && dirty) { dirty = false; void syncCloud(); } // nothing changed: nothing to write
  });
  window.addEventListener('online', () => void syncCloud());
  void syncCloud();
}

/** A short explanation for a sign-in error. Returns null when the player just closed the popup. */
export function describeAuthError(e: unknown): string | null {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (code === 'auth/operation-not-allowed') return 'That sign-in method is not turned on for this game yet.';
  if (code === 'auth/unauthorized-domain') return 'Sign-in is not allowed from this web address yet.';
  if (code === 'auth/network-request-failed') return 'No connection. Try again when you are online.';
  if (code === 'auth/invalid-email') return 'That email address does not look right.';
  if (code === 'auth/email-already-in-use') return 'That email already has an account. Use SIGN IN instead.';
  if (code === 'auth/weak-password') return 'Choose a password of at least 6 characters.';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Wrong email or password. New here? Use CREATE ACCOUNT.';
  if (code === 'auth/too-many-requests') return 'Too many tries. Wait a minute and try again.';
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') return 'That sign-in link has expired or was already used. Ask for a new one.';
  return `Sign-in failed (${code.replace('auth/', '') || 'unknown error'}).`;
}
