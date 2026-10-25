// Fails if the built site contains a privileged Supabase key (build prompt 4.6).
// New-style secret keys are recognised by prefix; legacy JWT keys are decoded, because their
// role ("service_role") is base64-encoded and invisible to a plain text search.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist'
const files = []
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(dir)

const problems = []
for (const file of files) {
  const text = readFileSync(file, 'latin1')
  if (/sb_secret_[A-Za-z0-9_-]+/.test(text)) problems.push(`${file}: contains an sb_secret_ key`)
  for (const [token] of text.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      if (payload.role && payload.role !== 'anon')
        problems.push(`${file}: JWT with role "${payload.role}"`)
    } catch {
      // Not a JWT payload; ignore.
    }
  }
}
if (problems.length) {
  console.error(`Privileged key material found in ${dir}:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`No privileged keys in ${files.length} files under ${dir}`)
