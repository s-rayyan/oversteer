import { cachedAccount, describeAuthError, lastSyncedAt, signInWithGoogle, signOutAccount, syncCloud } from '../net/account';

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
