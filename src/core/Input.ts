/** Keyboard & mouse input with pointer-lock mouse deltas. */
export class Input {
  private keys: Record<string, boolean> = {};
  private pressedThisFrame = new Set<string>();
  private buttons = [false, false, false];
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelAcc = 0;
  locked = false;

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.pressedThisFrame.add(e.code);
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.buttons = [false, false, false]; });

    el.addEventListener('mousedown', (e) => {
      if (e.button < 3) this.buttons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) this.wheelAcc += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
  }

  isDown(code: string): boolean { return !!this.keys[code]; }
  pressed(code: string): boolean { return this.pressedThisFrame.has(code); }
  buttonDown(idx: number): boolean { return this.buttons[idx]; }

  /** accumulated wheel notches since last frame: +1 down (zoom out), -1 up (zoom in) */
  consumeWheel(): number {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return w;
  }

  /** test hook: inject key/button state programmatically */
  setKey(code: string, down: boolean): void { this.keys[code] = down; }
  setButton(idx: number, down: boolean): void { this.buttons[idx] = down; }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  requestLock(): void {
    if (!this.locked) {
      const p = (this.el as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
