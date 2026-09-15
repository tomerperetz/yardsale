import { Price } from '@/components/Price'
import { percent, type SaleProgress as Progress } from '@/lib/admin/sale-progress'
import styles from './sale-progress.module.css'

/**
 * Two bars at the top of the seller's day: how much of the stuff has gone, and
 * how much of the money.
 *
 * They answer different questions and that is why there are two. Half the
 * items can be sold while a tenth of the money has come in — it usually is,
 * because the small things go first — and a seller reading only the item bar
 * would think the sale was half over.
 *
 * Every number is written out beside its bar. A bar alone is a shape; "12 מתוך
 * 20" is something the seller can act on, and it is what makes the width
 * checkable rather than decorative.
 */
export function SaleProgress({ progress }: { progress: Progress }) {
  const itemsPct = percent(progress.itemsSold, progress.itemsTotal)
  const moneyPct = percent(progress.soldAgorot, progress.potentialAgorot)

  if (progress.itemsTotal === 0) {
    return (
      <section className={styles.panel}>
        <h2>התקדמות המכירה</h2>
        <p className={styles.empty}>עדיין אין פריטים למכירה. כשיהיו, כאן יופיע כמה מהם נמכרו וכמה כסף נכנס.</p>
      </section>
    )
  }

  return (
    <section className={styles.panel}>
      <h2>התקדמות המכירה</h2>

      <div className={styles.bars}>
        <Bar
          label="פריטים שנמכרו"
          pct={itemsPct}
          detail={`${progress.itemsSold} מתוך ${progress.itemsTotal}`}
        />
        <Bar
          label="כסף שנכנס"
          pct={moneyPct}
          detail={
            <>
              <Price agorot={progress.soldAgorot} /> מתוך <Price agorot={progress.potentialAgorot} />
            </>
          }
        />
      </div>
    </section>
  )
}

/**
 * `aria-valuenow` and the visible percentage are the same number by
 * construction: a progressbar whose label and width disagree is worse than no
 * label at all. The width is the only place it is a percentage sign.
 */
function Bar({ label, pct, detail }: { label: string; pct: number; detail: React.ReactNode }) {
  return (
    <div className={styles.bar}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.pct}>{pct}%</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Width, not transform: the track is the full inline size and in a
            dir="rtl" document the fill grows from the right on its own. */}
        <span className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <p className={styles.detail}>{detail}</p>
    </div>
  )
}
