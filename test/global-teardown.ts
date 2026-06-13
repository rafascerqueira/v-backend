import { execSync } from 'node:child_process'

module.exports = async () => {
	// In CI the containers are GitHub-managed service containers and are torn
	// down with the job — nothing to do, and no compose to spam the log.
	if (process.env.CI) return

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
