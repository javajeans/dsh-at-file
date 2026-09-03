import { createHash, createPrivateKey, sign } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const pluginJson = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'))
const version = process.env.PLUGIN_VERSION ?? packageJson.version
const pluginId = process.env.PLUGIN_ID ?? packageJson.name
if (pluginId !== packageJson.name || pluginJson.name !== pluginId || pluginJson.version !== version) {
  throw new Error('PLUGIN_ID/version must match package.json and dsh.plugin.json')
}

const artifactPath = resolve(process.env.PLUGIN_ARTIFACT_PATH ?? join(root, 'release', `${pluginId}-${version}.tar.zst`))
const artifact = await readFile(artifactPath)
const artifactStat = await stat(artifactPath)
const sha256 = createHash('sha256').update(artifact).digest('hex')
const platforms = (process.env.PLUGIN_PLATFORMS ?? 'darwin-aarch64,darwin-x64').split(',').map(value => value.trim()).filter(Boolean)
const permissions = JSON.parse(process.env.PLUGIN_PERMISSIONS_JSON ?? '{"filesystem":["workspace"]}')
const manifest = {
  pluginId,
  version,
  pluginTypes: ['host', 'client'],
  summary: process.env.PLUGIN_SUMMARY ?? pluginJson.description,
  description: process.env.PLUGIN_DESCRIPTION ?? packageJson.description,
  harness: {
    minVersion: process.env.HARNESS_MIN_VERSION ?? '0.1.0',
    ...(process.env.HARNESS_MAX_VERSION ? { maxVersion: process.env.HARNESS_MAX_VERSION } : {}),
  },
  runtimeApi: Number(process.env.RUNTIME_API ?? '1'),
  platforms,
  permissions,
  artifact: { sha256, size: artifactStat.size },
}

const privateKeyPath = process.env.PLUGIN_SIGNING_PRIVATE_KEY_PATH
const privateKeyPem = process.env.PLUGIN_SIGNING_PRIVATE_KEY_PEM
const keyId = process.env.PLUGIN_SIGNING_KEY_ID
if ((!privateKeyPath && !privateKeyPem) || !keyId) throw new Error('PLUGIN_SIGNING_PRIVATE_KEY_PATH or PLUGIN_SIGNING_PRIVATE_KEY_PEM, plus PLUGIN_SIGNING_KEY_ID, are required')
const privateKey = createPrivateKey(privateKeyPem ?? await readFile(resolve(privateKeyPath)))
const signingPayload = {
  pluginId: manifest.pluginId,
  version: manifest.version,
  pluginTypes: manifest.pluginTypes,
  summary: manifest.summary ?? null,
  description: manifest.description ?? null,
  harness: { minVersion: manifest.harness.minVersion, maxVersion: manifest.harness.maxVersion ?? null },
  runtimeApi: manifest.runtimeApi,
  platforms: manifest.platforms,
  permissions: Object.fromEntries(Object.entries(manifest.permissions).sort(([left], [right]) => left.localeCompare(right))),
  artifact: manifest.artifact,
}
const signingBytes = Buffer.concat([Buffer.from('DSH-PLUGIN-MANIFEST-V1\0'), Buffer.from(JSON.stringify(signingPayload))])
manifest.signature = { keyId, value: sign(null, signingBytes, privateKey).toString('base64') }

const outputPath = resolve(process.env.PLUGIN_MANIFEST_PATH ?? join(root, 'release', 'plugin-manifest.json'))
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Created ${outputPath}`)
