# Implementation Plan: SaaS Structure Generator

## Overview

This plan implements the `--saas-structure` generator option for the `db-model-router` CLI. The implementation follows a bottom-up approach: utility modules first, then generators (migrations, models, middleware, routes, seeds), then the orchestrator, and finally CLI integration. Tests are placed close to the code they validate.

## Tasks

- [x] 1. Implement core utility generators
  - [x] 1.1 Create `src/cli/saas/generate-saas-utils.js` — password utility generator
    - Implement `generatePasswordUtil()` that returns the content string for `commons/password.js`
    - The generated file must use Node.js built-in `crypto.scrypt` for hashing (salt + derived key)
    - Must export `hashPassword(password)` and `verifyPassword(password, hash)` functions
    - No external dependencies allowed
    - _Requirements: 2.4, 18.6_

  - [x] 1.2 Create `src/cli/saas/generate-saas-utils.js` — modules utility generator
    - Implement `generateModulesUtil()` that returns the content string for `commons/modules.js`
    - The generated file must export a `modules` array with: "users", "tenants", "roles", "permissions", "webhooks"
    - Must export an `isValidModule(name)` helper function
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 1.3 Create `src/cli/saas/generate-saas-utils.js` — webhook utility generator
    - Implement `generateWebhookUtil()` that returns the content string for `commons/webhook.js`
    - Must include `signPayload(payload, secret)` using HMAC-SHA256
    - Must include `sendWebhook(tenantId, event, context)` with retry logic
    - Retry delays: [0, 60, 300, 3600, 86400] seconds with exponential backoff
    - Must log each retry attempt with attempt number and interval
    - Must call `logWebhookEvent()` for success, failure, and error states
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 11.2, 11.3, 11.4_

  - [x] 1.4 Write property tests for password utility (Property 4)
    - **Property 4: Password hash round-trip**
    - For any random password string, hashing then verifying the same password returns true; verifying a different password returns false
    - Use `fc.string({ minLength: 1, maxLength: 72 })` arbitrary
    - **Validates: Requirements 2.4, 18.6**

  - [x] 1.5 Write property tests for modules utility (Property 12)
    - **Property 12: Module registry validation**
    - For any string in the modules array, `isValidModule` returns true; for any string not in the array, returns false
    - Use `fc.constantFrom(...)` for valid modules and `fc.string()` filtered for invalid ones
    - **Validates: Requirements 6.3**

  - [x] 1.6 Write property tests for webhook signature (Property 7)
    - **Property 7: Webhook payload signature round-trip**
    - For any payload object and secret string, signing and re-computing HMAC-SHA256 produces matching result
    - **Validates: Requirements 10.5**

  - [x] 1.7 Write property test for webhook retry schedule (Property 8)
    - **Property 8: Webhook retry delay schedule**
    - For any attempt number n (0–4), the computed delay equals [0, 60, 300, 3600, 86400][n]
    - **Validates: Requirements 10.7**

- [x] 2. Implement migration generator
  - [x] 2.1 Create `src/cli/saas/generate-saas-migrations.js`
    - Implement `generateSaasMigrations(adapter, timestamp)` returning an array of `{ relPath, content }` objects
    - Generate CREATE TABLE SQL for 6 tables: tenants, roles, users, role_permissions, webhooks, webhook_logs
    - Use incrementing timestamps (+0s through +5s) for correct execution order
    - Include proper column types per adapter (reuse `mapColumnType` from existing `generate-migration.js`)
    - Include foreign key constraints: users→tenants, users→roles, roles→tenants, role_permissions→roles, webhooks→tenants, webhook_logs→webhooks
    - Include unique constraints: tenants(slug), users(tenant_id, email), roles(tenant_id, name)
    - Support all SQL adapters: postgres, mysql, sqlite3, mssql, oracle, cockroachdb
    - _Requirements: 2.2, 2.3, 3.2, 3.3, 4.2, 4.3, 5.3, 10.6, 11.5, 12.1, 12.2, 12.3_

  - [x] 2.2 Write property test for migration ordering (Property 2)
    - **Property 2: Migration ordering and foreign key integrity**
    - For any SQL adapter, timestamps are in correct dependency order and FK constraints are present
    - Use `fc.constantFrom("postgres", "mysql", "sqlite3", "mssql", "oracle", "cockroachdb")` arbitrary
    - **Validates: Requirements 12.1, 12.3**

  - [x] 2.3 Write property test for unique constraints (Property 3)
    - **Property 3: Unique constraints present in migrations**
    - For any SQL adapter, migrations include unique on tenants.slug, composite unique on users(tenant_id, email), composite unique on roles(tenant_id, name)
    - **Validates: Requirements 2.3, 3.3, 4.3**

- [x] 3. Implement model generator
  - [x] 3.1 Create `src/cli/saas/generate-saas-models.js`
    - Implement `generateSaasModels(adapter)` returning an array of `{ relPath, content }` objects
    - Generate model files for: users, tenants, roles, role_permissions, webhooks, webhook_logs
    - Follow existing `generateModelFile` pattern with `model(db, table, structure, pk, unique, option)`
    - Include correct field definitions for each table per the design data models
    - _Requirements: 2.1, 3.1, 4.1, 5.1, 10.1, 11.1_

- [ ] 4. Implement middleware generators
  - [x] 4.1 Create `src/cli/saas/generate-saas-middleware.js` — authenticate middleware
    - Implement `generateAuthenticateMiddleware()` returning `{ relPath, content }` for `middleware/authenticate.js`
    - Check `req.session` and `req.session.user` existence
    - Return 401 if no valid session; call `next()` if valid
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.2 Create `src/cli/saas/generate-saas-middleware.js` — tenant isolation middleware
    - Implement `generateTenantIsolationMiddleware()` returning `{ relPath, content }` for `middleware/tenantIsolation.js`
    - Check if user has any global-scoped permission
    - If no global permission: inject `req.session.user.tenant_id` into `req.query.tenant_id` and `req.body.tenant_id`
    - If global permission exists: pass through without restriction
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 4.3 Create `src/cli/saas/generate-saas-middleware.js` — hasPermission middleware
    - Implement `generateHasPermissionMiddleware()` returning `{ relPath, content }` for `middleware/hasPermission.js`
    - Export `hasPermission(module, action)` returning a middleware function
    - Validate module exists in modules registry via `isValidModule`
    - Check `req.session.permission` for matching module + (exact action OR "global" action)
    - Return 403 if invalid module or missing permission; call `next()` if authorized
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.4 Write property test for permission validation (Property 5)
    - **Property 5: Permission validation correctness**
    - For any permissions array and module/action pair, `hasPermission` calls next() iff module is valid AND permissions contain matching entry
    - Use `arbPermission` and `arbModuleName` arbitraries
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5**

  - [x] 4.5 Write property test for tenant isolation (Property 6)
    - **Property 6: Tenant isolation scoping**
    - For any user without global permissions, tenant_id is injected; for any user with global permission, no restriction applied
    - **Validates: Requirements 8.2, 8.3**

  - [x] 4.6 Write property test for permission action validation (Property 11)
    - **Property 11: Permission action validation**
    - For any action in valid set, validator accepts; for any string not in set, validator rejects
    - Valid actions: "read", "write", "update", "delete", "export", "approve", "global"
    - **Validates: Requirements 5.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement route generators
  - [x] 6.1 Create `src/cli/saas/generate-saas-routes.js` — CRUD route generator
    - Implement `generateCrudRoutes()` returning an array of `{ relPath, content }` objects
    - Generate route files for: users, tenants, roles (each with full CRUD: GET, POST, PUT, DELETE)
    - Generate nested route file at `routes/roles/permissions.js` for role_permissions CRUD
    - All routes must include middleware chain: authenticate → tenantIsolation → hasPermission(module, action)
    - Roles route must include guard: tenant admin cannot modify system roles (tenant_id === null)
    - Roles route must include guard: non-global users cannot create/update roles with global permissions
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 17.1, 17.2, 17.3, 17.4_

  - [x] 6.2 Create `src/cli/saas/generate-saas-routes.js` — auth route generator
    - Implement `generateAuthRoutes()` returning `{ relPath, content }` for `routes/auth.js`
    - POST `/api/auth/login`: validate credentials, populate session with user/role/permission, return 401 on failure
    - POST `/api/auth/logout`: protected by authenticate middleware, destroy session, return 200 on success / 500 on failure
    - Use `verifyPassword` from generated `commons/password.js`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 20.1, 20.2, 20.3, 20.4_

  - [x] 6.3 Create `src/cli/saas/generate-saas-routes.js` — routes index generator
    - Implement `generateRoutesIndex()` returning `{ relPath, content }` for `routes/index.js`
    - Wire all route files together with proper Express router mounting
    - _Requirements: 16.1_

  - [x] 6.4 Write property test for CRUD route middleware chain (Property 10)
    - **Property 10: Generated CRUD routes include full middleware chain**
    - For any generated CRUD route file, the code includes authenticate, tenantIsolation, and hasPermission with correct module/action
    - **Validates: Requirements 16.3, 16.4, 16.5**

  - [x] 6.5 Write property test for global permission escalation prevention (Property 9)
    - **Property 9: Global permission escalation prevention**
    - For any user without global permissions and role request with scope "global", route responds 403; for user with global permissions, request is allowed
    - **Validates: Requirements 17.1, 17.2, 17.3**

- [x] 7. Implement seed generator
  - [x] 7.1 Create `src/cli/saas/generate-saas-seeds.js`
    - Implement `generateSaasSeeds(adapter)` returning an array of `{ relPath, content }` objects
    - Generate `seeds/saas-seed.js` that inserts:
      - Super Admin user with NULL tenant_id, cryptographically random password, all permissions for all modules
      - Tenant Admin Role with NULL tenant_id, tenant-scoped CRUD permissions for users and roles (no global permissions)
    - Generate `credentials.md` with super admin email and generated password, plus change-password warning
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 15.1, 15.2, 15.3, 15.4, 19.1, 19.2, 19.3, 19.5_

  - [x] 7.2 Write property test for tenant admin role permissions (Property 13)
    - **Property 13: Tenant admin role has no global permissions**
    - For any permission entry in the generated Tenant Admin Role seed data, scope never equals "global"
    - **Validates: Requirements 15.4**

  - [x] 7.3 Write property test for super admin permissions (Property 14)
    - **Property 14: Super admin has all permissions for all modules**
    - For any module in the registry and any action in valid actions set, super admin seed contains a corresponding permission entry
    - **Validates: Requirements 14.2**

- [x] 8. Implement orchestrator and CLI integration
  - [x] 8.1 Create `src/cli/generate-saas-structure.js` — main orchestrator
    - Implement `generateSaasStructure(adapter, options)` that calls all sub-generators
    - Aggregate all `{ relPath, content }` arrays from migrations, models, middleware, routes, seeds, and utils
    - Include `.gitignore` update to add `credentials.md`
    - Return the combined `planned[]` array
    - Accept `options` object with `{ dryRun, json, timestamp }`
    - _Requirements: 1.3, 13.3, 19.4_

  - [x] 8.2 Modify `src/cli/commands/generate.js` — add saas-structure option
    - Add `saas-structure` to the generation questionnaire choices
    - Add `--saas-structure` flag detection
    - When active: prompt for adapter selection (from supported adapters list)
    - Delegate to `generateSaasStructure(adapter, options)` and use existing file write loop
    - Support `--dry-run` and `--json` flags with existing reporting format
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1, 13.2, 13.4_

  - [x] 8.3 Write property test for complete file generation (Property 1)
    - **Property 1: Complete file generation across adapters**
    - For any valid adapter, the generator produces the complete set of expected files (models, migrations, middleware, routes, seeds, utilities)
    - Use `fc.constantFrom("postgres", "mysql", "sqlite3", "mssql", "oracle", "cockroachdb", "mongodb", "dynamodb", "redis")` arbitrary
    - **Validates: Requirements 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.3, 10.1, 10.6, 11.1, 11.5**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Write unit tests
  - [x] 10.1 Write unit tests for CLI integration (`test/saas-structure.test.js`)
    - Test questionnaire includes saas-structure option
    - Test `--dry-run` mode lists files without writing
    - Test `--json` output format correctness
    - Test invalid adapter selection handling
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 10.2 Write unit tests for file output and reporting
    - Test file status reporting (created, overwritten, unchanged)
    - Test credentials.md format and content (email + password + warning)
    - Test .gitignore update behavior (adds credentials.md entry)
    - Test directory creation for nested paths
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 19.1, 19.2, 19.3, 19.4_

  - [x] 10.3 Write unit tests for seed file content
    - Test super admin has NULL tenant_id
    - Test super admin has all permissions for all modules
    - Test tenant admin role structure (NULL tenant_id, tenant-scoped permissions)
    - Test tenant admin role has no global permissions
    - _Requirements: 14.1, 14.2, 14.3, 15.1, 15.2, 15.3, 15.4_

  - [x] 10.4 Write unit tests for auth routes
    - Test login route populates session on valid credentials
    - Test login route returns 401 on invalid credentials
    - Test logout route destroys session and returns 200
    - Test logout route returns 500 on session destroy failure
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 20.1, 20.2, 20.3, 20.4_

  - [x] 10.5 Write unit tests for middleware generators
    - Test authenticate middleware returns 401 without session
    - Test tenant isolation injects tenant_id for non-global users
    - Test hasPermission returns 403 for invalid module
    - Test hasPermission returns 403 for missing permission
    - _Requirements: 7.2, 8.2, 8.3, 9.3, 9.4, 9.5_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All property tests go in `test/properties/saas-structure.property.test.js`
- All unit tests go in `test/saas-structure.test.js`
- The project uses Mocha + fast-check (both already in devDependencies)
- All generated code is JavaScript (matching the existing codebase)
