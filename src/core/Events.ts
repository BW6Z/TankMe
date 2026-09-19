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
  tankFire: 'tank:fire',            // {tank}
  projectileHit: 'combat:projectileHit', // {shooter, victim, zone, point}
  armorPenetrated: 'combat:armorPenetrated', // {shooter, victim, amount, crit, module, zone, point, killed}
  armorBlocked: 'combat:armorBlocked',       // {shooter, victim, zone, point, reason: 'armor'|'ricochet'}
  criticalHit: 'combat:criticalHit',          // {shooter, victim, module, point}
  tankDamaged: 'tank:damaged',      // {victim, attacker, amount, point}
  moduleDamaged: 'tank:moduleDamaged', // {tank, module}
  tankDeath: 'tank:death',          // {victim, attacker}
  tankRespawn: 'tank:respawn',      // {tank}
  powerupSpawn: 'powerup:spawn',    // {def, point}
  powerupPickup: 'powerup:pickup',  // {tank, def}
  matchTick: 'match:tick',          // {timeLeft}
  matchEnd: 'match:end',            // {winner, scores, stats...}
  scoreChanged: 'score:changed',    // {a, b}
} as const;
