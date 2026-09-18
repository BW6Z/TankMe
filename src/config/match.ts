/** Match rules — all tunable in one place. */

export interface MatchModeDef {
  id: '7v7' | '14v14';
  teamSize: number;
  scoreLimit: number;
  label: string;
  desc: string;
}

export const MATCH_MODES: MatchModeDef[] = [
  {
    id: '7v7',
    teamSize: 7,
    scoreLimit: 30,
    label: 'SKIRMISH 7v7',
    desc: 'Seven tanks per team. A focused, readable engagement across the whole valley.',
  },
  {
    id: '14v14',
    teamSize: 14,
    scoreLimit: 55,
    label: 'FRONTLINE 14v14',
    desc: 'Fourteen tanks per team. Total war — every lane contested, every stone counts.',
  },
];

export const MATCH_CONFIG = {
  /** battle duration in seconds */
  duration: 8 * 60,
  /** score awarded per kill */
  killScore: 1,
  /** seconds before a destroyed tank respawns */
  respawnTime: 6,
  /** seconds of invulnerability after spawning (ends early on firing) */
  spawnProtection: 3,
} as const;

export const TEAMS = [
  { id: 0, name: 'COBALT', color: 0x4da3ff, cssColor: '#4da3ff' },
  { id: 1, name: 'CRIMSON', color: 0xff5d5d, cssColor: '#ff5d5d' },
] as const;

export type TeamId = 0 | 1;

/** AI callsigns per team, e.g. COBALT-2 */
export function aiCallsign(team: TeamId, index: number): string {
  return `${TEAMS[team].name}-${index}`;
}

/** AI role mix for a team of size N (player excluded) */
export function roleMixFor(teamSize: number): string[] {
  // roles: assault, flanker, sniper, support, defender
  if (teamSize <= 7) return ['assault', 'assault', 'flanker', 'sniper', 'support', 'defender'];
  return [
    'assault', 'assault', 'assault', 'flanker', 'flanker', 'sniper', 'sniper',
    'support', 'support', 'defender', 'defender', 'assault', 'flanker', 'sniper',
  ].slice(0, teamSize - 1);
}
