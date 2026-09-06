'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveSettingsAction, type SettingsInput } from './actions'
import formStyles from '@/components/admin/admin.module.css'
import styles from './settings.module.css'

/**
 * A form over the `Settings` singleton row — shop identity, the BIT
 * number, pickup address, the three slot hour labels, and the hold
 * length. Nothing here is pre-filled with a placeholder shop name/phone/
 * address: every field starts exactly at what `Settings` holds, empty or not.
 */
export function SettingsForm({ settings }: { settings: SettingsInput }) {
  const router = useRouter()
  const [values, setValues] = useState<SettingsInput>(settings)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set<K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    if (pending) return
    setPending(true)
    setError(null)
    const result = await saveSettingsAction(values)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className={formStyles.fields}>
      {error && (
        <div className={formStyles.errors}>
          <p>{error}</p>
        </div>
      )}

      <div>
        <label className="lbl" htmlFor="set-shopName">
          שם החנות
        </label>
        <input
          id="set-shopName"
          className="fld"
          value={values.shopName}
          onChange={(e) => set('shopName', e.target.value)}
        />
      </div>

      <div>
        <label className="lbl" htmlFor="set-tagline">
          תיאור קצר <span className={formStyles.hint}>לא חובה</span>
        </label>
        <input id="set-tagline" className="fld" value={values.tagline} onChange={(e) => set('tagline', e.target.value)} />
      </div>

      <div>
        <label className="lbl" htmlFor="set-bitPhone">
          מספר טלפון לביט
        </label>
        <input
          id="set-bitPhone"
          className="fld fld-phone"
          type="tel"
          dir="ltr"
          value={values.bitPhone}
          onChange={(e) => set('bitPhone', e.target.value)}
        />
      </div>

      <div className={formStyles.two}>
        <div>
          <label className="lbl" htmlFor="set-addressLine">
            כתובת
          </label>
          <input
            id="set-addressLine"
            className="fld"
            value={values.addressLine}
            onChange={(e) => set('addressLine', e.target.value)}
          />
        </div>
        <div>
          <label className="lbl" htmlFor="set-city">
            עיר
          </label>
          <input id="set-city" className="fld" value={values.city} onChange={(e) => set('city', e.target.value)} />
        </div>
      </div>

      <div className={styles.slotGrid}>
        <div>
          <label className="lbl" htmlFor="set-slotMorning">
            שעות בוקר
          </label>
          <input
            id="set-slotMorning"
            className="fld"
            placeholder="09:00–12:00"
            value={values.slotMorning}
            onChange={(e) => set('slotMorning', e.target.value)}
          />
        </div>
        <div>
          <label className="lbl" htmlFor="set-slotAfternoon">
            שעות אחה״צ
          </label>
          <input
            id="set-slotAfternoon"
            className="fld"
            placeholder="12:00–17:00"
            value={values.slotAfternoon}
            onChange={(e) => set('slotAfternoon', e.target.value)}
          />
        </div>
        <div>
          <label className="lbl" htmlFor="set-slotEvening">
            שעות ערב
          </label>
          <input
            id="set-slotEvening"
            className="fld"
            placeholder="17:00–20:00"
            value={values.slotEvening}
            onChange={(e) => set('slotEvening', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="lbl" htmlFor="set-holdMinutes">
          משך המתנה לתשלום (בדקות)
        </label>
        <input
          id="set-holdMinutes"
          className="fld"
          type="number"
          inputMode="numeric"
          min={1}
          dir="ltr"
          value={values.holdMinutes}
          onChange={(e) => set('holdMinutes', e.target.value)}
        />
      </div>

      <div className={formStyles.actions}>
        <button type="button" className="btn btn-accent" disabled={pending} onClick={handleSave}>
          {pending ? 'שומר…' : 'שמירה'}
        </button>
        {saved && <span className={styles.saved}>נשמר</span>}
      </div>
    </div>
  )
}
