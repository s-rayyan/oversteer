import { cleanCode } from '../net/pvp';

/** DOM modal asking for a room code (same look as askName). Resolves with the 5-character code, or null if cancelled. */
export function askCode(): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(11,10,20,.85);font-family:monospace;';
    wrap.innerHTML = `
      <form style="background:#1d1b2e;border:3px solid #ffd166;padding:20px 24px;width:min(340px,86vw);color:#fff;text-align:center">
        <div style="color:#ffd166;font-size:20px;margin-bottom:8px">ROOM CODE</div>
        <div style="color:#8d99ae;font-size:12px;margin-bottom:14px">Ask the host for their 5-character code.</div>
        <input maxlength="5" autocomplete="off" spellcheck="false" placeholder="ABCDE"
          style="width:100%;box-sizing:border-box;background:#14121f;border:2px solid #3d405b;color:#ffd166;font:22px monospace;letter-spacing:6px;text-align:center;padding:8px;outline:none;text-transform:uppercase" />
        <div data-err style="color:#e63946;font-size:12px;height:16px;margin-top:6px"></div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:6px">
          <button type="submit" style="background:#ffd166;border:0;color:#14121f;font:bold 14px monospace;padding:8px 18px;cursor:pointer">JOIN</button>
          <button type="button" data-cancel style="background:#3d405b;border:0;color:#fff;font:14px monospace;padding:8px 18px;cursor:pointer">CANCEL</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);

    const input = wrap.querySelector('input')!;
    const err = wrap.querySelector<HTMLElement>('[data-err]')!;
    input.focus();
    const done = (v: string | null) => {
      wrap.remove();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    wrap.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
    wrap.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = cleanCode(input.value);
      if (code.length !== 5) {
        err.textContent = 'Codes have 5 letters or numbers.';
        return;
      }
      done(code);
    });
  });
}
