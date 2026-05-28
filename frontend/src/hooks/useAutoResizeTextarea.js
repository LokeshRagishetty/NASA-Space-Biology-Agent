import { useLayoutEffect } from 'react'

export function useAutoResizeTextarea(ref, value, maxHeight = 180) {
  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [maxHeight, ref, value])
}
