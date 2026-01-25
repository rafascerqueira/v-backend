/*
 Pre-start script for development:
 - Ensures Docker containers are running
*/

const { spawnSync } = require('child_process')
const fs = require('fs')

async function main() {
  const hasCompose = fs.existsSync('docker-compose.yml') || fs.existsSync('docker-compose.yaml')
  
  if (hasCompose) {
    console.log('[dev-prestart] Starting Docker containers (db + redis)...')
    const up = spawnSync('docker', ['compose', 'up', '-d', 'db', 'redis'], { 
      stdio: 'inherit', 
      env: process.env 
    })
    
    if (up.status === 0) {
      console.log('[dev-prestart] Docker containers started.')
    } else {
      console.warn('[dev-prestart] Docker compose failed, assuming services are running externally.')
    }
  }

  console.log('[dev-prestart] Ready to start NestJS.')
}

main().catch((e) => {
  console.error('[dev-prestart] Unexpected error:', e)
  process.exit(1)
})
