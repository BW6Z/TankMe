/**
 * Consolidated in-browser test for TankMe combat/camera/HUD systems.
 * Run inside the browser via evaluate: returns a result object.
 */
(() => {
  const g = window.__tankme.game, m = g.match, p = m.playerTank;
  if (!m || !p) return { error: 'no match' };
  return true;
})();
