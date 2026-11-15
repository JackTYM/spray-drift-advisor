// maplibre-gl runs part of itself in a web worker loaded by URL. The bundler does not emit that file,
// so it is copied into public/ after install and the map is pointed at it.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const dist = join(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist')
mkdirSync('public', { recursive: true })
copyFileSync(join(dist, 'maplibre-gl-worker.mjs'), 'public/maplibre-gl-worker.mjs')
