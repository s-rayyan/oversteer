import Phaser from 'phaser';

/**
 * Phaser hands every key press to the scenes straight away (so a key can start fullscreen or audio), but it keeps
 * the presses in a queue until the end of the frame and hands over the whole queue each time. When two keys land in
 * the same frame (DOWN then ENTER on a menu, easy when a frame is slow, as in the 3D game) the first one was acted
 * on twice, and a menu could run two of its entries. This makes each scene see each key press once.
 */
interface Plugin {
  manager: { queue: KeyboardEvent[] };
  update(): void;
}

const done = new WeakMap<Plugin, WeakSet<KeyboardEvent>>();
const proto = Phaser.Input.Keyboard.KeyboardPlugin.prototype as unknown as Plugin;
const original = proto.update;

proto.update = function (this: Plugin): void {
  const mgr = this.manager;
  const all = mgr?.queue;
  if (!all?.length) return original.call(this);
  let seen = done.get(this);
  if (!seen) done.set(this, (seen = new WeakSet()));
  const fresh = all.filter((e) => !seen!.has(e));
  if (!fresh.length) return;
  fresh.forEach((e) => seen!.add(e));
  mgr.queue = fresh;
  try {
    original.call(this);
  } finally {
    mgr.queue = all;
  }
};
