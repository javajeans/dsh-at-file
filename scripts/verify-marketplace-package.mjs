import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const pluginJson = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'))
const artifactPath = resolve(process.env.PLUGIN_ARTIFACT_PATH ?? join(root, 'release', `${packageJson.name}-${packageJson.version}.tar.zst`))
const manifestPath = resolve(process.env.PLUGIN_MANIFEST_PATH ?? join(root, 'release', 'plugin-manifest.json'))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const artifact = await readFile(artifactPath)
const artifactStat = await stat(artifactPath)
const entries = execFileSync('sh', ['-c', 'zstd -d -c "$1" | tar -tf -', 'verify', artifactPath], { encoding: 'utf8' }).split('\n').filter(Boolean)

const forbidden = entries.filter(entry => entry.startsWith('/') || entry.split('/').includes('..'))
if (forbidden.length > 0) throw new Error(`archive contains unsafe paths: ${forbidden.join(', ')}`)
for (const required of ['harnone-plugin/package.json', 'harnone-plugin/dsh.plugin.json', 'harnone-plugin/cordis.patch.yml', 'harnone-plugin/lib/index.js', 'harnone-plugin/lib/client.js']) {
  if (!entries.includes(required)) throw new Error(`archive is missing ${required}`)
}
if (entries.some(entry => entry === 'harnone-plugin/plugin-manifest.json')) throw new Error('plugin-manifest.json must remain a separate Release Asset')
if (manifest.pluginId !== packageJson.name || manifest.version !== packageJson.version || pluginJson.name !== manifest.pluginId || pluginJson.version !== manifest.version) {
  throw new Error('package, dsh.plugin.json and plugin-manifest.json identity/version do not match')
}
if (manifest.artifact.sha256 !== createHash('sha256').update(artifact).digest('hex') || manifest.artifact.size !== artifactStat.size) {
  throw new Error('plugin-manifest.json artifact digest or size does not match the archive')
}
if (!manifest.signature?.keyId || !manifest.signature?.value) throw new Error('plugin-manifest.json must be signed')
console.log(`Verified ${artifactPath}`)
