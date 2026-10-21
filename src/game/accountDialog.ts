import { cachedAccount, describeAuthError, lastSyncedAt, signInWithGoogle, signOutAccount, syncCloud } from '../net/account';
import { firebaseConfigured } from '../net/firebase';
import { getCoins, ownedCount } from './profile';
import { getLocalBests } from './records';

const ago = (t: number): string => {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

const btn = 'background:#ffd166;border:0;color:#14121f;font:bold 14px monospace;padding:10px 18px;cursor:pointer;width:100%;margin-top:8px';
const link = 'background:none;border:0;color:#8d99ae;font:12px monospace;margin-top:12px;cursor:pointer;text-decoration:underline';

/** DOM popup for signing in to (or out of) the optional online account. `onChange` runs when the state changes. */
export function showAccountDialog(onChange: () => void): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(11,10,20,.88);font-family:monospace;padding:12px;box-sizing:border-box';
  document.body.appendChild(wrap);
  wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') wrap.remove(); });
  wrap.addEventListener('keyup', (e) => e.stopPropagation());

  const card = (inner: string) => {
    wrap.innerHTML = `<div style="background:#1d1b2e;border:3px solid #ffd166;padding:18px 22px;width:min(400px,100%);color:#fff;text-align:center">
      <div style="color:#ffd166;font-size:20px;margin-bottom:8px">ONLINE ACCOUNT</div>${inner}
      <div data-msg style="color:#e63946;font-size:12px;min-height:16px;margin-top:8px"></div>
      <button data-close style="${link}">close</button></div>`;
    wrap.querySelector('[data-close]')!.addEventListener('click', () => wrap.remove());
  };
  const msg = (text: string, ok = false) => {
    const el = wrap.querySelector<HTMLElement>('[data-msg]');
    if (el) { el.style.color = ok ? '#52b788' : '#e63946'; el.textContent = text; }
  };
  const busy = (b: HTMLButtonElement, text: string) => { b.disabled = true; b.textContent = text; };

  const signedOut = () => {
    card(`<p style="color:#c9d1e3;font-size:13px;line-height:1.5;margin:0 0 6px">Sign in with Google to keep your coins, cars and records safe online and use them on any device.</p>
      <p style="color:#8d99ae;font-size:12px;line-height:1.5;margin:0">Your leaderboard scores stay yours. Without signing in, progress lives only in this browser.</p>
      <button data-go style="${btn}">SIGN IN WITH GOOGLE</button>`);
    wrap.querySelector<HTMLButtonElement>('[data-go]')!.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      busy(b, 'WAITING FOR GOOGLE...');
      try {
        await signInWithGoogle();
        onChange();
        signedIn();
      } catch (err) {
        b.disabled = false;
        b.textContent = 'SIGN IN WITH GOOGLE';
        const text = describeAuthError(err);
        if (text) msg(text);
      }
    });
  };

  const signedIn = () => {
    const a = cachedAccount();
    if (!a) return signedOut();
    card(`<p style="color:#c9d1e3;font-size:13px;line-height:1.5;margin:0 0 4px">Signed in as</p>
      <p style="color:#ffd166;font-size:14px;margin:0 0 10px;word-break:break-all">${a.label.replace(/[<>&]/g, '')}</p>
      <p style="color:#8d99ae;font-size:12px;margin:0">Your progress is saved online. Last saved: ${ago(lastSyncedAt())}</p>
      <button data-sync style="${btn}">SAVE NOW</button>
      <button data-out style="${link}">sign out of this device</button>`);
    wrap.querySelector<HTMLButtonElement>('[data-sync]')!.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      busy(b, 'SAVING...');
      await syncCloud();
      signedIn();
      msg('Saved!', true);
    });
    wrap.querySelector<HTMLButtonElement>('[data-out]')!.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (!confirm('Sign out? This device keeps its progress but stops saving it online until you sign in again.')) return;
      busy(b, 'signing out...');
      try {
        await signOutAccount();
      } catch {
        /* offline: the local sign-out below still takes effect on next load */
      }
      onChange();
      signedOut();
    });
  };

  if (cachedAccount()) signedIn(); else signedOut();
}

// ---------- reminder to sign in ----------

// Not under the `oversteer.` prefix: that's the save, and this is just when the player last said "not now".
const REMINDER_KEY = 'oversteerSignInReminder';
const REMINDER_EVERY_MS = 20 * 60 * 60 * 1000; // at most about once a day
let remindedThisVisit = false;

/**
 * True when it's time to nudge the player to sign in: they aren't signed in, they have progress to lose, it's the
 * first time this visit, and they haven't said "not now" in the last day.
 */
export function shouldRemindSignIn(): boolean {
  if (!firebaseConfigured || cachedAccount() || remindedThisVisit) return false;
  if (getCoins() <= 0 && ownedCount() <= 1 && getLocalBests().length === 0) return false;
  try {
    return Date.now() - (Number(localStorage.getItem(REMINDER_KEY)) || 0) > REMINDER_EVERY_MS;
  } catch {
    return true;
  }
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/** Popup warning that progress lives only in this browser, with a one-click Google sign-in. */
export function showSignInReminder(onChange: () => void): void {
  remindedThisVisit = true;
  const coins = getCoins();
  const cars = ownedCount();
  const records = getLocalBests().length;
  const atRisk = [coins > 0 && plural(coins, 'coin'), cars > 1 && plural(cars, 'car'), records > 0 && plural(records, 'record')]
    .filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(11,10,20,.88);font-family:monospace;padding:12px;box-sizing:border-box';
  document.body.appendChild(wrap);
  // Keep the game from reacting to keys while the popup is open (Enter would otherwise start a race behind it).
  wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') later(); });
  wrap.addEventListener('keyup', (e) => e.stopPropagation());

  wrap.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="signin-title" style="background:#1d1b2e;border:3px solid #e63946;padding:18px 22px;width:min(430px,100%);color:#fff;text-align:center;box-sizing:border-box">
    <div id="signin-title" style="color:#ffd166;font-size:19px;margin-bottom:10px">YOUR PROGRESS ISN'T BACKED UP</div>
    <p style="color:#c9d1e3;font-size:13px;line-height:1.5;margin:0 0 10px">Your ${atRisk} are saved <b style="color:#fff">only in this browser</b>.</p>
    <div style="background:rgba(230,57,70,.14);border:1px solid #e63946;color:#ffb3b8;font-size:12px;line-height:1.55;text-align:left;padding:9px 11px;margin:0 0 12px">
      <b style="color:#ff6b75">You will lose them for good if:</b><br>
      &bull; you clear your browsing data or cookies<br>
      &bull; you play in a private / incognito window<br>
      &bull; you switch to another browser or device<br>
      &bull; this computer is reset (school computers often are)
    </div>
    <p style="color:#c9d1e3;font-size:12px;line-height:1.5;margin:0">Sign in with Google to keep them safe online and play on any device. Your leaderboard scores stay yours.</p>
    <button data-go style="${btn}">SIGN IN WITH GOOGLE</button>
    <div data-msg style="color:#e63946;font-size:12px;min-height:16px;margin-top:8px"></div>
    <button data-later style="${link};margin-top:4px">not now (I understand I could lose my progress)</button>
  </div>`;

  const msg = wrap.querySelector<HTMLElement>('[data-msg]')!;
  const go = wrap.querySelector<HTMLButtonElement>('[data-go]')!;
  function later(): void {
    try { localStorage.setItem(REMINDER_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    wrap.remove();
  }
  wrap.querySelector('[data-later]')!.addEventListener('click', later);
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'WAITING FOR GOOGLE...';
    msg.textContent = '';
    try {
      await signInWithGoogle();
      onChange();
      go.textContent = 'SIGNED IN - YOUR PROGRESS IS SAFE';
      go.style.background = '#52b788';
      setTimeout(() => wrap.remove(), 1400);
    } catch (err) {
      go.disabled = false;
      go.textContent = 'SIGN IN WITH GOOGLE';
      const text = describeAuthError(err);
      if (text) { msg.style.color = '#e63946'; msg.textContent = text; }
    }
  });
  go.focus();
}
