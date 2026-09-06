'use client'

import { useRef, useState } from 'react'

/**
 * One "payline" row from panel 3 of the mockup: a labelled value plus a
 * copy button. `navigator.clipboard` is unavailable over plain HTTP and
 * can reject even when present (no permission, no user-gesture in some
 * embedded browsers), so a failure there falls back to selecting the
 * value's text instead of doing nothing — the value is always plain,
 * selectable text regardless of which path runs.
 */
export function CopyField({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  const [copied, setCopied] = useState(false)
  const valueRef = useRef<HTMLSpanElement>(null)

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no Clipboard API')
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const el = valueRef.current
      const selection = window.getSelection?.()
      if (el && selection) {
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }

  return (
    <div className="payline">
      <span>
        <span className="k">{label}</span>
        <span className="v" dir={dir} ref={valueRef}>
          {value}
        </span>
      </span>
      <button type="button" className="copy" onClick={handleCopy}>
        {copied ? 'הועתק' : 'העתקה'}
      </button>
    </div>
  )
}
