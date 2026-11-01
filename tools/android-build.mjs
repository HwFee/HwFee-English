import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(projectRoot, 'android');
const isWindows = process.platform === 'win32';
const wrapper = isWindows ? 'gradlew.bat' : 'gradlew';
const gradleArgs = process.argv.slice(2);

if (gradleArgs.length === 0) {
  console.error('Usage: node tools/android-build.mjs <Gradle task> [Gradle options...]');
  process.exit(2);
}

const command = isWindows ? wrapper : 'sh';
const commandArgs = isWindows ? gradleArgs : [wrapper, ...gradleArgs];
const result = spawnSync(command, commandArgs, {
  cwd: androidDir,
  stdio: 'inherit',
  // Windows requires a shell to launch .bat files; use a cwd-relative path so
  // project directory spaces do not become part of the shell command path.
  shell: isWindows,
});

if (result.error) {
  console.error(`Could not start Gradle wrapper: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`Gradle wrapper terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
