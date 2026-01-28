module.exports = {
	apps: [
		{
			name: 'vendinhas-api',
			script: 'dist/main.js',
			instances: 'max',
			exec_mode: 'cluster',
			autorestart: true,
			watch: false,
			max_memory_restart: '500M',
			env: {
				NODE_ENV: 'production',
				PORT: 3001,
			},
			env_production: {
				NODE_ENV: 'production',
				PORT: 3001,
			},
			error_file: './logs/err.log',
			out_file: './logs/out.log',
			log_file: './logs/combined.log',
			time: true,
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		},
	],
}
