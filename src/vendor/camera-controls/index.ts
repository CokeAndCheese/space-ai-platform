/**
 * camera-controls 本地化入口
 *
 * 上游源码本来就是 TS,直接 re-export 即可。
 * 上游 index.ts 内容:export { CameraControls as default } from './CameraControls'
 *
 * 这里写成命名 + 默认双导出,方便 ESM / CJS 风格都可用。
 */

export { CameraControls as default, CameraControls } from './CameraControls'
export { EventDispatcher } from './EventDispatcher'
