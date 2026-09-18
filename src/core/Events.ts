/** Minimal typed-ish event bus shared across systems. */
type Handler = (payload: any) => void;

export class Emitter {
  private handlers = new Map<string, Set<Handler>>();

  on(name: string, h: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(h);
    return () => set!.delete(h);
  }

  emit(name: string, payload?: any): void {
    const set = this.handlers.get(name);
    if (set) for (const h of set) h(payload);
  }
}

export const bus = new Emitter();

/** Event names used across the game */
export const EV = {
  combatHit: 'combat:hit',          // {shooter, victim, amount, crit, point, killed}
  tankFire: 'tank:fire',            // {tank}
  tankDamaged: 'tank:damaged',      // {victim, attacker, amount, point}
  tankDeath: 'tank:death',          // {victim, attacker}
  tankRespawn: 'tank:respawn',      // {tank}
  powerupSpawn: 'powerup:spawn',    // {def, point}
  powerupPickup: 'powerup:pickup',  // {tank, def}
  matchTick: 'match:tick',          // {timeLeft}
  matchEnd: 'match:end',            // {winner, scores, stats...}
  scoreChanged: 'score:changed',    // {a, b}
} as const;
