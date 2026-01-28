# Backend vendinhas

## Introdução
O backend vendinhas deve fornecer ao frontend uma API RESTful para gerenciar os dados da aplicação e garantir com que os dados estejam consistentes e seguros, respeitando a legislação brasileira vigente - LGPD (Lei Geral de Proteção de Dados Pessoais). Seguir Padrões de projeto recomendados com Clean Architecture e SOLID. Utilizar as últimas versões estáveis dos frameworks e bibliotecas, afim de evitar vulnerabilidades de segurança e garantir performance.
Arquitetura: Multi-tenant (múltiplos clientes separados logicamente).
Este projeto visa ser um CRM simples para vendedores autônomos e pequenos negócios, no qual apoia o controle de vendas e estoque de produtos, realiza pedidos e gerencia clientes. Permite compras online através de link personalizado para os clientes cadastrados ou um catálogo genérico para novos clientes. Importante ser "Mobile First", ou seja, priorizar a experiência mobile, sem esquecer a experiência web.
Tipo de aplicação: SaaS (Software as a Service) Freemium, dando acesso básico gratuito e funcionalidades premium pagas.

## Tecnologias
- Node.js
- NestJS
- TypeScript
- Fastify
- PostgreSQL
- Redis
- Prisma
- JWT
- Bcrypt
- Zod
- Swagger
- Docker
- Biome
- Jest

## Regras gerais

> Importante: O Sistema ficará "free for use" até 28 de Fevereiro de 2026 (ou outra data que o Admin pode redefinir na página de administração e enviar ao backend a nova data), e depois disso os usuários cadastrados podem adquirir planos pagos com preço promocional (early adopters).

- Multi-tenant: cada cliente tem seu próprio espaço isolado.
- Login com e-mail e senha, com autenticação JWT e refresh token.
- Autenticação via Google e Facebook.
- Recuperação de senha via e-mail.
- O reset de senha deve forçar a alteração da senha.
- Validação de e-mail ao cadastrar novo usuário.
- Cadastro de novo usuário para acesso ao sistema.
- Dois tipos de usuários do sistema: Admin (Sysadmin / Help Desk) e usuário comum (Vendedor).
- Dois tipos de planos: Free (gratuito) e Pro (pago).
- Plano Free permite cadastrar até 60 produtos e 40 clientes no total, com limite mensal de 30 vendas.
- Plano Pro libera as funcionalidades avançadas do sistema, dados ilimitados, insights de vendas baseado em análise de dados dos clientes.
- Usuário Admin pode criar, editar e excluir usuários do sistema.
- Usuário Admin pode gerenciar planos dos usuários e configurações do sistema em Geral.
- Usuário Admin pode gerenciar os clientes de todos os usuários.
- Usuário comum (Vendedor) pode gerenciar seus próprios dados, incluindo nome, telefone, endereço e foto.
- integração com inteligência artificial, especializada nos clientes para oferecer sugestões de produtos e serviços.
- Dados sensíveis devem ser anonimizados, garantindo proteção e adequação conforme rege a legislação brasileira (LGPD).
- Triggers, Procedures e Functions que possam auxiliar na manutenção dos dados (considerando não impactar performance).
- Produtos mudam de preço conforme atualização do preço do produto, e também é possível dar descontos nos produtos de acordo com o que o usuário julgar necessário.
- O usuário pode criar promoções para os produtos em estoque (e isso deve ser registrado no histórico de preços dos produtos).
- O usuário pode criar pacotes de produtos (conjunto de produtos) e oferecer descontos nesses pacotes.
- O usuário pode administrar os débitos com os fornecedores.
- O usuário deve realizar o faturamento do seu cliente conforme modalidade de cobrança (mensal, quinzenal, por data predefinida e por venda).
- O usuário pode dar descontos sobre a fatura do cliente caso prefira (evitando mexer no preço original do produto em sua base).
- O Sistema deve implementar soluções de proteção de ataques de força bruta e tentativas de invasão.
- O sistema deverá implementar logs de auditoria para todas as ações críticas do sistema.
- O Admin deverá consultar os logs de auditoria de uma forma mais amigável e intelegível para poder identificar problemas e ações realizadas pelos usuários.
- O sistema deverá estar preparado para fazer integração com outras APIs como consulta de produto por código de barras, integração com meios de pagamento, etc.
- O sistema deverá ter uma solução simples para armazenar imagem de produtos e perfil do usuário, com restrição de limite do tamanho de arquivo e redimensionamento de pixels (otimizando com alguma biblioteca) com possibilidade de migrar para um CDN caso for necessário.
