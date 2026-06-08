# Requirements Document

## Introduction

This document specifies the requirements for a `--saas-structure` generator option within the `db-model-router` CLI. The generator scaffolds the core multi-tenant SaaS architecture including foundational database tables, reusable middleware for authentication, tenant isolation, and permission validation, a webhook delivery system, CRUD API routes for core entities, seed data for system-level users and role templates, and a login authentication flow. The feature integrates into the existing `generate` command questionnaire and produces ready-to-use models, routes, middleware, migrations, seeds, and utility modules.

## Glossary

- **CLI**: The `db-model-router` command-line interface tool
- **Generator**: The code generation subsystem within the CLI that produces source files from templates
- **Tenant**: An isolated organizational unit in a multi-tenant SaaS application; each tenant has its own users, roles, and data
- **Module**: A named functional area within the SaaS application (e.g., "invoices", "reports") registered in the modules repository
- **Permission**: An access control entry that grants a specific action on a specific module to a role
- **Role**: A named collection of permissions assigned to users within a tenant
- **Global_Permission**: A permission scope that grants access across all tenants in the system
- **Webhook**: An HTTP callback mechanism that notifies tenant systems of events occurring within the SaaS application
- **Session_Context**: The authenticated user's identity, role, and permissions stored in `req.session` after login
- **Permission_Helper**: A reusable middleware function (`hasPermission`) that validates whether the current user has a required permission for a given module and action
- **Modules_Repository**: The `modules.js` file that stores all registered module names in the system
- **Super_Admin**: A system-level user with all permissions across all modules; has a NULL tenant_id indicating system-wide scope
- **Tenant_Admin_Role**: A role template created by the Super_Admin with NULL tenant_id; grants administrative permissions within a specific tenant when assigned to a user
- **Credentials_File**: The `credentials.md` file generated in the project directory containing the Super_Admin's randomized password
- **CRUD_Routes**: The generated RESTful API route files providing Create, Read, Update, and Delete operations for core SaaS entities

## Requirements

### Requirement 1: CLI Integration

**User Story:** As a developer, I want to select `saas-structure` from the generate command questionnaire, so that I can scaffold a complete multi-tenant SaaS backend architecture.

#### Acceptance Criteria

1. WHEN the developer runs the `generate` command, THE CLI SHALL present `saas-structure` as a selectable option in the generation questionnaire
2. WHEN the developer selects `saas-structure`, THE Generator SHALL prompt for the target database adapter (from the supported adapters list)
3. WHEN the developer confirms the selection, THE Generator SHALL produce all SaaS structure files in the project directory
4. THE Generator SHALL support the `--dry-run` flag to preview planned files without writing them
5. THE Generator SHALL support the `--json` flag to output results in machine-readable JSON format

### Requirement 2: Users Table Generation

**User Story:** As a developer, I want a users table generated with appropriate fields, so that I can manage user accounts in my SaaS application.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a users model file with fields for user identity (id, email, password_hash, name, tenant_id, role_id, created_at, modified_at)
2. THE Generator SHALL create a corresponding SQL migration file for the users table
3. THE Generator SHALL enforce a unique constraint on the email field within a tenant scope
4. THE Generator SHALL hash the password_hash field using the Node.js built-in `crypto` module (scrypt or pbkdf2) without requiring any external dependencies

### Requirement 3: Tenants Table Generation

**User Story:** As a developer, I want a tenants table generated, so that I can isolate data between different organizations using my application.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a tenants model file with fields for tenant identity (id, name, slug, created_at, modified_at)
2. THE Generator SHALL create a corresponding SQL migration file for the tenants table
3. THE Generator SHALL enforce a unique constraint on the tenant slug field

### Requirement 4: Roles Table Generation

**User Story:** As a developer, I want a roles table generated, so that I can define named permission groups for users within each tenant.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a roles model file with fields (id, tenant_id, name, created_at, modified_at)
2. THE Generator SHALL create a corresponding SQL migration file for the roles table
3. THE Generator SHALL enforce a unique constraint on the combination of tenant_id and role name

### Requirement 5: Role Permissions Table Generation

**User Story:** As a developer, I want a role_permissions table generated, so that I can assign granular permissions to each role.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a role_permissions model file with fields (permission_id, role_id, permission, created_at, modified_at)
2. THE Generator SHALL store the permission field as a JSON object containing module name, action, and scope
3. THE Generator SHALL create a corresponding SQL migration file for the role_permissions table
4. THE Generator SHALL support the following actions in the permission object: "read", "write", "update", "delete", "export", "approve", "global"

### Requirement 6: Modules Repository Generation

**User Story:** As a developer, I want a modules.js file generated that stores all available module names, so that the permission system can reference valid modules.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a `modules.js` file in the commons directory
2. THE Modules_Repository SHALL export an array of module name strings
3. THE Modules_Repository SHALL include a helper function to validate whether a given module name exists in the registry
4. WHEN a new module is added to the SaaS application, THE Modules_Repository SHALL be the single location where the module name is registered
5. THE Modules_Repository SHALL be pre-populated with all core generated modules: "users", "tenants", "roles", "permissions", and "webhooks"

### Requirement 7: Authentication Middleware Generation

**User Story:** As a developer, I want authentication middleware generated, so that incoming requests are validated for a valid session before accessing protected resources.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create an authentication middleware file
2. WHEN a request arrives without a valid session, THE Authentication_Middleware SHALL respond with HTTP 401 status
3. WHEN a request arrives with a valid session, THE Authentication_Middleware SHALL populate `req.session.user` with the authenticated user object
4. WHEN a request arrives with a valid session, THE Authentication_Middleware SHALL populate `req.session.role` with the user's role object
5. WHEN a request arrives with a valid session, THE Authentication_Middleware SHALL populate `req.session.permission` with the user's permissions array

### Requirement 8: Tenant Isolation Middleware Generation

**User Story:** As a developer, I want tenant isolation middleware generated, so that users can only access data belonging to their own tenant unless they have global permissions.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a tenant isolation middleware file
2. WHILE a user without global permissions is authenticated, THE Tenant_Isolation_Middleware SHALL restrict all data queries to the user's own tenant_id
3. WHILE a user with global permissions is authenticated, THE Tenant_Isolation_Middleware SHALL allow access to data across all tenants

### Requirement 9: Permission Validation Middleware Generation

**User Story:** As a developer, I want a reusable permission helper generated, so that I can protect routes by checking if the user has the required permission for a module and action.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a permission validation middleware file exposing a `hasPermission(module, action)` function
2. WHEN `hasPermission("module", "action")` is called, THE Permission_Helper SHALL check the user's permissions in `req.session.permission` for a matching module and action entry
3. WHEN the user lacks the required permission, THE Permission_Helper SHALL respond with HTTP 403 status
4. WHEN the user possesses the required permission, THE Permission_Helper SHALL call `next()` to continue request processing
5. THE Permission_Helper SHALL validate that the specified module exists in the Modules_Repository before checking permissions

### Requirement 10: Webhook System Generation

**User Story:** As a developer, I want a webhook system generated, so that tenant systems can be notified of events occurring within the SaaS application.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a webhooks table model with fields (id, tenant_id, url, key, secret, created_at, modified_at)
2. THE Generator SHALL create a `common/webhook.js` utility file that exposes a function for sending webhooks
3. WHEN the webhook send function is called, THE Webhook_System SHALL look up the configured webhook URL for the specified tenant
4. WHEN the webhook send function is called, THE Webhook_System SHALL construct a payload containing context (phone, email, attributes) and event (the data to pass to the tenant)
5. THE Webhook_System SHALL sign the webhook payload using the tenant's configured secret for verification
6. THE Generator SHALL create a corresponding SQL migration file for the webhooks table
7. IF a webhook delivery fails, THEN THE Webhook_System SHALL retry delivery up to 5 times with exponential backoff at intervals of 0, 60, 300, 3600, and 86400 seconds
8. WHEN a retry attempt is made, THE Webhook_System SHALL log each retry attempt with the attempt number and scheduled interval

### Requirement 11: Webhook Event Logging

**User Story:** As a developer, I want every webhook event logged with its delivery status, so that I can audit and troubleshoot webhook deliveries.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a webhook_logs table model with fields (id, webhook_id, tenant_id, event_type, payload, status, response_body, response_status_code, created_at)
2. WHEN a webhook is sent, THE Webhook_System SHALL create a log entry with the event payload and delivery status
3. WHEN a webhook delivery receives a response, THE Webhook_System SHALL store the response body and HTTP status code in the log entry
4. IF a webhook delivery fails due to a network error, THEN THE Webhook_System SHALL log the failure with an error status and the error message
5. THE Generator SHALL create a corresponding SQL migration file for the webhook_logs table

### Requirement 12: Migration File Generation

**User Story:** As a developer, I want all required database migrations generated in the correct order, so that I can set up the SaaS schema by running the migration tool.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL produce migration files with timestamps that ensure correct execution order (tenants before users, roles before role_permissions, webhooks before webhook_logs)
2. THE Generator SHALL produce migration files compatible with the project's existing migration runner format
3. THE Generator SHALL include foreign key constraints between related tables (users.tenant_id references tenants.id, users.role_id references roles.id, roles.tenant_id references tenants.id, webhooks.tenant_id references tenants.id, webhook_logs.webhook_id references webhooks.id)

### Requirement 13: File Output and Reporting

**User Story:** As a developer, I want clear reporting of all generated files, so that I know what was created or modified in my project.

#### Acceptance Criteria

1. WHEN files are generated, THE Generator SHALL report each file's path and status (created, overwritten, unchanged)
2. WHEN the `--dry-run` flag is provided, THE Generator SHALL list all planned files without writing any to disk
3. THE Generator SHALL create necessary directories if they do not exist
4. THE Generator SHALL follow the existing project convention for file output reporting (matching the current generate command's output format)

### Requirement 14: Super Admin Seeding

**User Story:** As a developer, I want a super admin user auto-seeded with a randomized password, so that I have an initial system-level account with full access to manage the SaaS platform.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a seed file that inserts a Super_Admin user with a cryptographically randomized password
2. THE Generator SHALL assign all permissions across all modules (user, tenant, role, permission) to the Super_Admin user
3. THE Generator SHALL set the Super_Admin user's tenant_id to NULL to indicate system-level scope
4. THE Generator SHALL set tenant_id to NULL for all system-level users created during seeding
5. WHEN the seed file executes, THE Generator SHALL write the Super_Admin's randomized password to a `credentials.md` file in the project directory
6. THE Credentials_File SHALL contain the Super_Admin email and the generated password in a human-readable format

### Requirement 15: Tenant Admin Role Seeding

**User Story:** As a developer, I want a Tenant Admin role template seeded, so that tenant administrators can be assigned a pre-defined role with tenant-scoped management permissions.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a seed file that inserts a Tenant_Admin_Role with a NULL tenant_id
2. THE Tenant_Admin_Role SHALL include permissions to create, read, update, and delete users within the assigned tenant
3. THE Tenant_Admin_Role SHALL include permissions to create, read, update, and delete roles within the assigned tenant
4. THE Tenant_Admin_Role SHALL NOT include any global permission entries
5. WHEN a user is assigned the Tenant_Admin_Role, THE system SHALL associate the user with a specific tenant through the user's tenant_id and role_id fields
6. WHILE a user with the Tenant_Admin_Role is authenticated, THE Permission_Helper SHALL restrict role and user management operations to the user's own tenant_id

### Requirement 16: CRUD API Routes Generation

**User Story:** As a developer, I want full CRUD API routes generated for core SaaS entities, so that I have a working API foundation for managing users, tenants, roles, and permissions.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create CRUD route files for Users, Tenants, Roles, and Permissions entities
2. THE Generator SHALL create a nested route file at `/api/roles/:role_id/permissions` for managing permissions within a specific role
3. THE Generator SHALL protect all generated CRUD routes with the Authentication_Middleware
4. THE Generator SHALL protect all generated CRUD routes with the Tenant_Isolation_Middleware
5. THE Generator SHALL protect all generated CRUD routes with the Permission_Helper middleware using appropriate module and action parameters
6. WHEN a user with the Tenant_Admin_Role attempts to modify a role with NULL tenant_id, THE CRUD_Routes SHALL respond with HTTP 403 status
7. THE Generator SHALL produce route files that follow the existing `db-model-router` route generation conventions

### Requirement 17: Permission Enforcement on Role Creation

**User Story:** As a developer, I want the system to prevent tenant admins from creating roles with global permissions, so that privilege escalation across tenants is blocked.

#### Acceptance Criteria

1. WHEN a user without Global_Permission attempts to create a role containing a global permission entry, THE CRUD_Routes SHALL respond with HTTP 403 status
2. WHEN a user without Global_Permission attempts to update a role to include a global permission entry, THE CRUD_Routes SHALL respond with HTTP 403 status
3. WHILE a user with Global_Permission is authenticated, THE CRUD_Routes SHALL allow creating roles that include global permission entries
4. THE CRUD_Routes SHALL validate the permission entries in the request body before persisting a new role or role update

### Requirement 18: Authentication Login Route Generation

**User Story:** As a developer, I want a login endpoint generated, so that users can authenticate and establish a session with their identity, role, and permissions.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a login route file exposing a POST `/api/auth/login` endpoint for authentication
2. WHEN valid credentials are submitted to the login endpoint, THE login route SHALL populate `req.session.user` with the authenticated user object
3. WHEN valid credentials are submitted to the login endpoint, THE login route SHALL populate `req.session.role` with the user's role object
4. WHEN valid credentials are submitted to the login endpoint, THE login route SHALL populate `req.session.permission` with the user's permissions array
5. WHEN invalid credentials are submitted to the login endpoint, THE login route SHALL respond with HTTP 401 status and a descriptive error message
6. THE login route SHALL verify the submitted password against the stored password_hash using the Node.js built-in `crypto` module (scrypt or pbkdf2) without requiring any external dependencies

### Requirement 19: Super Admin Credentials Output

**User Story:** As a developer, I want the super admin's generated password written to a credentials file, so that I can use it for initial login without searching through seed scripts.

#### Acceptance Criteria

1. WHEN the seed file generates a randomized password for the Super_Admin, THE Generator SHALL write the credentials to a `credentials.md` file in the project root directory
2. THE Credentials_File SHALL include the Super_Admin email address and the generated password
3. THE Credentials_File SHALL include a warning that the password should be changed after first login
4. THE Generator SHALL add `credentials.md` to the project's `.gitignore` file to prevent accidental commit of sensitive data
5. IF a `credentials.md` file already exists, THEN THE Generator SHALL overwrite the file with the new credentials

### Requirement 20: Logout Route Generation

**User Story:** As a developer, I want a logout endpoint generated, so that users can terminate their session and clear their authentication state.

#### Acceptance Criteria

1. WHEN `saas-structure` is selected, THE Generator SHALL create a logout route file exposing a POST `/api/auth/logout` endpoint
2. WHEN a valid session exists and the logout endpoint is called, THE logout route SHALL destroy the session using `req.session.destroy()`
3. WHEN the session is successfully destroyed, THE logout route SHALL respond with HTTP 200 status and a success message
4. IF the session destruction fails, THEN THE logout route SHALL respond with HTTP 500 status and a descriptive error message
