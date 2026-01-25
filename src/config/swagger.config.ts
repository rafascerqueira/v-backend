import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { INestApplication } from '@nestjs/common'

export function setupSwagger(app: INestApplication): void {
	const config = new DocumentBuilder()
		.setTitle('Vendinhas API')
		.setDescription(`
## Sistema de Gestão de Vendas

API RESTful para gerenciamento completo de vendas, clientes, produtos e estoque.

### Autenticação

A API utiliza **JWT (JSON Web Tokens)** com algoritmo **RS256** (criptografia assimétrica).

- **Access Token**: Válido por 1 dia, usado para autenticar requisições
- **Refresh Token**: Válido por 7 dias, usado para renovar o access token
- **Logout**: Tokens são invalidados via blacklist no Redis

### Como autenticar

1. Faça login em \`POST /auth/login\`
2. Copie o \`accessToken\` da resposta
3. Clique no botão **Authorize** acima
4. Cole o token no formato: \`Bearer {seu_token}\`

### Cookies HttpOnly

Os tokens também são enviados como cookies HttpOnly para maior segurança.
O frontend pode optar por usar cookies ou o header Authorization.

### Códigos de Status

| Código | Descrição |
|--------|-----------|
| 200 | Sucesso |
| 201 | Recurso criado |
| 400 | Dados inválidos |
| 401 | Não autenticado |
| 403 | Não autorizado |
| 404 | Recurso não encontrado |
| 409 | Conflito (duplicado) |
| 500 | Erro interno |
		`)
		.setVersion('1.0.0')
		.setContact('Vendinhas Team', 'https://github.com/vendinhas', 'contato@vendinhas.com')
		.setLicense('MIT', 'https://opensource.org/licenses/MIT')
		.addServer('http://localhost:3000', 'Desenvolvimento')
		.addBearerAuth(
			{
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
				name: 'Authorization',
				description: 'Insira o token JWT',
				in: 'header',
			},
			'access-token',
		)
		.addTag('auth', 'Autenticação: login, logout, refresh token')
		.addTag('customers', 'CRUD de clientes')
		.addTag('products', 'CRUD de produtos')
		.addTag('product-prices', 'Gerenciamento de preços de produtos')
		.addTag('orders', 'Gerenciamento de pedidos')
		.addTag('billings', 'Faturamento e cobranças')
		.addTag('store-stock', 'Controle de estoque da loja')
		.addTag('stock-movements', 'Movimentações de entrada/saída de estoque')
		.addTag('health', 'Health check da aplicação')
		.build()

	const document = SwaggerModule.createDocument(app, config)
	SwaggerModule.setup('api/docs', app, document, {
		customSiteTitle: 'Vendinhas API - Documentação',
		customfavIcon: '/favicon.ico',
		customCss: `
			.swagger-ui .topbar { display: none }
			.swagger-ui .info .title { font-size: 2.5em }
		`,
		swaggerOptions: {
			persistAuthorization: true,
			tagsSorter: 'alpha',
			operationsSorter: 'alpha',
			docExpansion: 'none',
			filter: true,
			showRequestDuration: true,
		},
	})
}
