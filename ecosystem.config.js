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
			error_file: '/var/log/pm2/vendinhas-api-error.log',
			out_file: '/var/log/pm2/vendinhas-api-out.log',
			merge_logs: true,
			time: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		},
	],
}
