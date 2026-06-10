module.exports = {
	apps: [
		{
			name: 'vendinhas-api',
			cwd: '/var/www/vendinhas/backend',
			script: 'dist/main.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '500M',
			// NODE_ENV must be set HERE, not left to the on-disk .env. It gates
			// cookie `Secure` (secure: NODE_ENV === 'production') and `isProduction`
			// (CORS mode). If it isn't 'production', the access_token cookie is issued
			// WITHOUT Secure and the browser may refuse to send it back over the
			// cross-origin XHR to api.vendinhas.app → GET /auth/me returns 401.
			// `env` is always applied by PM2 (even without `--env production`), so this
			// is robust to the deploy running `pm2 reload ecosystem.config.js`.
			env: {
				NODE_ENV: 'production',
			},
			error_file: '/var/log/pm2/vendinhas-api-error.log',
			out_file: '/var/log/pm2/vendinhas-api-out.log',
			merge_logs: true,
			time: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		},
	],
}
