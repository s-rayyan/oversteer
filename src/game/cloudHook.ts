// Lets the save code say "something worth backing up changed" without knowing about Firebase.
let handler: (() => void) | null = null;

export const onSaveChanged = (fn: () => void): void => { handler = fn; };
export const saveChanged = (): void => handler?.();
