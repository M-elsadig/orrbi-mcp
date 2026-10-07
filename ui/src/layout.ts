/* How much room to leave under the last button in fullscreen. Claude on a
   phone draws its chat input (~120px) over the bottom of the page and
   doesn't count it in safeAreaInsets, so a touch/mobile host gets at least
   COMPOSER_CLEAR_PX; elsewhere the inset plus a little air. Pure, for tests. */
export const COMPOSER_CLEAR_PX = 140;

/* the parts of the MCP Apps host context this reads */
export type LayoutContext = {
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
  platform?: string;
  deviceCapabilities?: { touch?: boolean; hover?: boolean };
};

export function bottomClear(ctx: LayoutContext, coarsePointer: boolean): number {
  const inset = ctx.safeAreaInsets?.bottom ?? 0;
  const touch = ctx.platform === 'mobile' || !!ctx.deviceCapabilities?.touch || coarsePointer;
  return Math.max(inset + 16, touch ? COMPOSER_CLEAR_PX : 24);
}
