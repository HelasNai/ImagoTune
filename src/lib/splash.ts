/**
 * 启动页（v3.14）退场判定：纯逻辑，无 React/DOM。
 *
 * 退场条件：启动期数据就绪（settings / workspace / queue 全部 settle）且达到最短展示时长；
 * 上限兜底保证任何异常下启动页都不会无限遮挡界面；reduced-motion 下无最短展示
 * （动画已被禁用，就绪即可直通主界面）。
 */

/** 最短展示时长：覆盖入场 + 书写动画（约 1.4s）并留出短暂静止（非 reduced-motion）。 */
export const SPLASH_MIN_VISIBLE_MS = 1800;

/** 上限兜底：即使启动期数据始终未就绪，也在此刻强制退场（绝不无限遮挡）。 */
export const SPLASH_MAX_VISIBLE_MS = 6000;

/** 退场交叉动画时长；SplashScreen 在此之后回调 onExited 卸载。 */
export const SPLASH_EXIT_MS = 400;

export interface SplashDismissInput {
  /** 启动期数据（settings / workspace / queue）是否已全部 settle。 */
  ready: boolean;
  /** 自启动页挂载以来的毫秒数。 */
  elapsedMs: number;
  /** prefers-reduced-motion 命中时无最短展示。 */
  reducedMotion?: boolean;
}

/** 是否应当进入退场（进入后由调用方播放退场动画并卸载）。 */
export function shouldDismissSplash(input: SplashDismissInput): boolean {
  if (input.elapsedMs >= SPLASH_MAX_VISIBLE_MS) return true;
  const minMs = input.reducedMotion ? 0 : SPLASH_MIN_VISIBLE_MS;
  return input.ready && input.elapsedMs >= minMs;
}
