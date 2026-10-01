/** Process lifecycle flag shared between server.ts (sets it on SIGTERM) and /api/ready (reports it). */
const g = globalThis as unknown as { __dorDraining?: boolean };

export function setDraining(): void {
  g.__dorDraining = true;
}

export function isDraining(): boolean {
  return g.__dorDraining === true;
}
