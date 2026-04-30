in generate --db-manager should generate
DB manager using ejs db manager in the generated codebase (dark theme)
There is login page with just password -> Needs to login status in session (req.session["db-manager"])
the password will be in .env as DATABASE_MANAGER_PASSWORD
Then db manager page
Left sidebar will have list of tables with local search
Main page will have 3 tabs

1. Table Structure
2. Data top 30 rows with filter,sort,pagenation
3. Query page where user can type the raw query
   This needs to added in route like /database

The api that this will use is POST /database/login, GET /database/tables, GET /database/tables/:table_name?sort=1&size=30&post_name=%title%
