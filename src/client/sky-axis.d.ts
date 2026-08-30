// sky-axis 插件命名空间注册（ambient module augmentation）。
// 把 locales 的 SkyAxisKey 注入 dsh-client-ui-slots 的 LocaleNamespaceMap，
// 让 PropsLocale<'sky-axis'>['t'] 在全 client 包都拿到正确的 translate 类型。
import type { SkyAxisKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'sky-axis': SkyAxisKey
  }
}