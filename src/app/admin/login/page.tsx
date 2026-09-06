'use client'

import { useActionState } from 'react'
import { login } from './actions'
import styles from './login.module.css'

export default function LoginPage() {
  const [error, formAction, isPending] = useActionState(login, null)

  return (
    <main className={styles.ground}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap"
      />
      <form className={styles.card} action={formAction}>
        <div className={styles.mark} />
        <h1 className={styles.title}>כניסה לניהול</h1>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>
            סיסמה
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className={styles.input}
          />
        </div>

        <button type="submit" className={styles.submit} disabled={isPending}>
          כניסה
        </button>
      </form>
    </main>
  )
}
