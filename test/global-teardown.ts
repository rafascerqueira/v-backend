import { execSync } from 'node:child_process'

module.exports = async () => {
  try {
    // Always bring down test database container regardless of test outcome
    execSync('docker compose -f docker-compose.test.yml down', {
      stdio: 'inherit',
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to stop test database container', e)
  }
}
