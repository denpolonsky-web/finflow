// Прогон проверок бухгалтерского ядра и миграции.
// Запуск: npm test
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const files = ['tests/ledger.test.ts', 'tests/migrate.test.ts', 'tests/cloudConfig.test.ts']
let failed = 0

for (const entry of files) {
  const out = entry.replace(/\.ts$/, '.built.mjs')
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', outfile: out,
    platform: 'node', external: ['fake-indexeddb'],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
    },
  })
  console.log(`\n── ${entry} ──`)
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
  if (r.status !== 0) failed++
  rmSync(out, { force: true })
}

process.exit(failed ? 1 : 0)
