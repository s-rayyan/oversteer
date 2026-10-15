import { sanitizeName } from './player';

/**
 * DOM modal asking for the player's name (text input is far easier in HTML than in canvas).
 * Key events are stopped at the input so the game doesn't react while typing.
 * Resolves with the cleaned name, or null if cancelled.
 */
export function askName(initial: string, cancellable: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(11,10,20,.85);font-family:monospace;';
    wrap.innerHTML = `
      <form style="background:#1d1b2e;border:3px solid #ffd166;padding:20px 24px;width:min(340px,86vw);color:#fff;text-align:center">
        <div style="color:#ffd166;font-size:20px;margin-bottom:8px">WHO'S DRIVING?</div>
        <div style="color:#8d99ae;font-size:12px;margin-bottom:14px">Your name appears on the global leaderboard.</div>
        <input maxlength="12" autocomplete="off" spellcheck="false" placeholder="YOUR NAME"
          style="width:100%;box-sizing:border-box;background:#14121f;border:2px solid #3d405b;color:#ffd166;font:18px monospace;text-align:center;padding:8px;outline:none;text-transform:uppercase" />
        <div data-err style="color:#e63946;font-size:12px;height:16px;margin-top:6px"></div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:6px">
          <button type="submit" style="background:#ffd166;border:0;color:#14121f;font:bold 14px monospace;padding:8px 18px;cursor:pointer">OK</button>
          ${cancellable ? '<button type="button" data-cancel style="background:#3d405b;border:0;color:#fff;font:14px monospace;padding:8px 18px;cursor:pointer">CANCEL</button>' : ''}
        </div>
      </form>`;
    document.body.appendChild(wrap);

    const form = wrap.querySelector('form')!;
    const input = wrap.querySelector('input')!;
    const err = wrap.querySelector<HTMLElement>('[data-err]')!;
    input.value = initial;
    input.focus();
    input.select();

    const done = (v: string | null) => {
      wrap.remove();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && cancellable) done(null);
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    wrap.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sanitizeName(input.value);
      if (!name) {
        err.textContent = 'Use letters, numbers or spaces.';
        return;
      }
      done(name);
    });
  });
}
