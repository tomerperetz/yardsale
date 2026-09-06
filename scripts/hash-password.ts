import { hash } from '@node-rs/argon2'
import { createInterface } from 'node:readline/promises'

// Wrapped in an async main() rather than top-level await: this project has
// no "type": "module" in package.json (next.config.js relies on CJS
// module.exports), so tsx runs .ts files as CJS, which rejects top-level await.
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const password = await rl.question('Admin password: ')
  rl.close()

  if (password.length < 12) {
    console.error('Refusing: use at least 12 characters.')
    process.exit(1)
  }

  console.log('\nSet this as ADMIN_PASSWORD_HASH:\n')
  console.log(await hash(password))
  console.log(
    '\nWhen pasting into .env: escape every "$" as "\\$". Next.js interpolates' +
      ' $VAR syntax in env files and will silently corrupt an unescaped hash.',
  )
}

main()
