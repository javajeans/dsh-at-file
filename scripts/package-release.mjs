import { cp, mkdtemp, mkdir, readFile, readdir, rm, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const pluginJson = JSON.parse(await readFile(join(root, 'dsh.plugin.json'), 'utf8'))
const version = packageJson.version
const packageName = packageJson.name
if (pluginJson.name !== packageName || pluginJson.version !== version) {
  throw new Error('package.json and dsh.plugin.json name/version must match')
}

const requiredFiles = ['package.json', 'dsh.plugin.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) throw new Error(`release input is missing: ${file}`)
}

const outputDirectory = resolve(process.env.PLUGIN_RELEASE_DIR ?? join(root, 'release'))
const outputPath = resolve(process.env.PLUGIN_ARTIFACT_PATH ?? join(outputDirectory, `${packageName}-${version}.tar.zst`))
await mkdir(outputDirectory, { recursive: true })
const stage = await mkdtemp(join(root, '.release-stage-'))
const tarPath = join(stage, `${packageName}-${version}.tar`)
const stagedPlugin = join(stage, 'harndock-plugin')
const reproducibleTime = new Date('2000-01-01T00:00:00.000Z')

async function normalizeMtimes(path) {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await normalizeMtimes(child)
    await utimes(child, reproducibleTime, reproducibleTime)
  }
  await utimes(path, reproducibleTime, reproducibleTime)
}

try {
  await cp(join(root, 'package.json'), join(stagedPlugin, 'package.json'))
  await cp(join(root, 'dsh.plugin.json'), join(stagedPlugin, 'dsh.plugin.json'))
  await cp(join(root, 'cordis.patch.yml'), join(stagedPlugin, 'cordis.patch.yml'))
  await cp(join(root, 'lib'), join(stagedPlugin, 'lib'), { recursive: true })
  for (const file of ['README.md', 'README.zh.md', 'LICENSE']) {
    if (existsSync(join(root, file))) await cp(join(root, file), join(stagedPlugin, file))
  }
  await normalizeMtimes(stagedPlugin)

  const tar = spawnSync('tar', ['-cf', tarPath, '-C', stage, 'harndock-plugin'], {
    encoding: null,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  if (tar.error) throw tar.error
  if (tar.status !== 0) throw new Error(`tar failed with status ${String(tar.status)}`)
  const zstd = spawnSync('zstd', ['-q', '-19', '-f', tarPath, '-o', outputPath], { encoding: null })
  if (zstd.error) throw zstd.error
  if (zstd.status !== 0) throw new Error(`zstd failed with status ${String(zstd.status)}: ${zstd.stderr?.toString() ?? ''}`)
  console.log(`Created ${outputPath}`)
} finally {
  await rm(stage, { recursive: true, force: true })
}
