/**
 * Runs the Gradle wrapper in android/.
 *
 * `cd android && gradlew.bat ...` inside an npm script does not work: npm runs
 * scripts through cmd.exe, which did not resolve the wrapper from the working
 * directory, and spelling it `.\gradlew.bat` then breaks the same script under
 * Git Bash. Spawning it from Node sidesteps the shell entirely and picks the
 * right wrapper for the platform.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const android = path.join(root, 'android')
const wrapper = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const task = process.argv[2] || 'assembleDebug'

// Node refuses to spawn a .bat without a shell, and a shell re-splits the
// command on spaces -- which "C:\Users\...\new bilibili\..." has -- so the path
// is quoted for that case.
const win = process.platform === 'win32'
const res = spawnSync(win ? `"${wrapper}"` : wrapper, [task, '--console=plain'], {
  cwd: android,
  stdio: 'inherit',
  shell: win,
})
if (res.error) {
  console.error(res.error.message)
  process.exit(1)
}
process.exit(res.status ?? 1)
