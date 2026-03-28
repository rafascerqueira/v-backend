# Backend vendinhas

## Introduction
The vendinhas backend must provide the frontend with a RESTful API to manage application data and ensure that data is consistent and secure, respecting the current Brazilian legislation - LGPD (General Personal Data Protection Law). Follow recommended design patterns with Clean Architecture and SOLID. Use the latest stable versions of frameworks and libraries to avoid security vulnerabilities and ensure performance.
Architecture: Multi-tenant (multiple logically separated clients).
This project aims to be a simple CRM for autonomous sellers and small businesses, which supports sales and product inventory control, places orders and manages customers. Allows online purchases through a personalized link for registered customers or a generic catalog for new customers. Important to be "Mobile First", that is, prioritize the mobile experience, without forgetting the web experience.
Application type: SaaS (Software as a Service) Freemium, giving free basic access and paid premium features.

## Technologies
- Node.js
- NestJS
- TypeScript
- Fastify
- PostgreSQL
- Redis
- Prisma
- JWT
- Argon2id
- Zod
- Swagger
- Docker
- Biome
- Jest

## General Rules

> Important: The System will be "free for use" until May 28, 2026 (or another date that the Admin can redefine on the administration page and send the new date to the backend), and after that registered users can purchase paid plans with promotional prices (early adopters).

- Multi-tenant: each client has their own isolated space.
- Login with email and password, with JWT authentication and refresh token.
- Authentication via Google and Facebook.
- Password recovery via email.
- Password reset must force password change.
- Email validation when registering a new user.
- New user registration for system access.
- Two types of system users: Admin (Sysadmin / Help Desk) and common user (Seller).
- Two types of plans: Free (free) and Pro (paid).
- Free plan allows registering up to 60 products and 40 customers in total, with a monthly limit of 30 sales.
- Pro plan unlocks advanced system features, unlimited data, sales insights based on customer data analysis.
- Admin user can create, edit and delete system users.
- Admin user can manage user plans and general system settings.
- Admin user can manage all users' customers.
- Common user (Seller) can manage their own data, including name, phone, address and photo.
- Integration with artificial intelligence, specialized in customers to offer product and service suggestions.
- Sensitive data must be anonymized, ensuring protection and compliance according to Brazilian legislation (LGPD).
- Triggers, Procedures and Functions that can assist in data maintenance (considering not impacting performance).
- Products change price according to product price update, and it is also possible to give discounts on products according to what the user deems necessary.
- The user can create promotions for products in stock (and this must be recorded in the product price history).
- The user can create product packages (set of products) and offer discounts on these packages.
- The user can manage debts with suppliers.
- The user must bill their customer according to billing modality (monthly, fortnightly, by predefined date and by sale).
- The user can give discounts on the customer's invoice if they prefer (avoiding changing the original price of the product in their base).
- The System must implement protection solutions against brute force attacks and intrusion attempts.
- The system must implement audit logs for all critical system actions.
- The Admin should be able to consult audit logs in a more friendly and intelligible way to identify problems and actions performed by users.
- The system should be prepared to integrate with other APIs such as product consultation by barcode, integration with payment methods, etc.
- The system should have a simple solution for storing product images and user profile, with file size limit restrictions and pixel resizing (optimizing with some library) with the possibility of migrating to a CDN if necessary.
