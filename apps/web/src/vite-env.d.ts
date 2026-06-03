/// <reference types="vite/client" />

declare global {
  type DOMProps<E = HTMLElement> = Pick<React.DOMAttributes<E>, "children">
  type ComponentProps<E = HTMLElement> = React.HTMLAttributes<E>
  type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>
  type Any = any
  type AnyMap<K = string, V = Any> = Record<K, V>
  type Timeout = ReturnType<typeof setTimeout>
}

export {}
