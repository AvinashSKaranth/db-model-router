"use strict";

const SQL_ADAPTERS = [
  "mysql",
  "mariadb",
  "postgres",
  "sqlite3",
  "mssql",
  "cockroachdb",
  "oracle",
];

/**
 * Generate the auth middleware content string.
 * Returns an ES module that exports a default middleware function
 * checking req.session["db-manager"] === true.
 *
 * @returns {string}
 */
function generateDbManagerAuthMiddleware() {
  return [
    "export default function dbManagerAuth(req, res, next) {",
    '  if (req.session["db-manager"] === true) {',
    "    return next();",
    "  }",
    '  res.redirect("/database/login");',
    "}",
    "",
  ].join("\n");
}

/**
 * Generate the login page EJS template content string.
 * Returns a complete HTML page with dark theme, password form,
 * error display, and 503 not-configured message.
 *
 * @returns {string}
 */
function generateLoginTemplate() {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>DB Manager - Login</title>",
    "  <style>",
    "    * { margin: 0; padding: 0; box-sizing: border-box; }",
    "    body {",
    '      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    "      background: #1a1a2e;",
    "      color: #e0e0e0;",
    "      display: flex;",
    "      align-items: center;",
    "      justify-content: center;",
    "      min-height: 100vh;",
    "    }",
    "    .login-container {",
    "      background: #16213e;",
    "      padding: 2rem;",
    "      border-radius: 8px;",
    "      width: 100%;",
    "      max-width: 400px;",
    "      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);",
    "    }",
    "    h1 {",
    "      text-align: center;",
    "      margin-bottom: 1.5rem;",
    "      color: #e0e0e0;",
    "      font-size: 1.5rem;",
    "    }",
    "    .error {",
    "      background: #e74c3c;",
    "      color: #fff;",
    "      padding: 0.75rem;",
    "      border-radius: 4px;",
    "      margin-bottom: 1rem;",
    "      text-align: center;",
    "    }",
    "    .not-configured {",
    "      background: #e67e22;",
    "      color: #fff;",
    "      padding: 0.75rem;",
    "      border-radius: 4px;",
    "      margin-bottom: 1rem;",
    "      text-align: center;",
    "    }",
    "    label {",
    "      display: block;",
    "      margin-bottom: 0.5rem;",
    "      color: #b0b0b0;",
    "    }",
    '    input[type="password"] {',
    "      width: 100%;",
    "      padding: 0.75rem;",
    "      border: 1px solid #2a2a4a;",
    "      border-radius: 4px;",
    "      background: #0f3460;",
    "      color: #e0e0e0;",
    "      font-size: 1rem;",
    "      margin-bottom: 1rem;",
    "    }",
    '    input[type="password"]:focus {',
    "      outline: none;",
    "      border-color: #533483;",
    "    }",
    "    button {",
    "      width: 100%;",
    "      padding: 0.75rem;",
    "      background: #533483;",
    "      color: #fff;",
    "      border: none;",
    "      border-radius: 4px;",
    "      font-size: 1rem;",
    "      cursor: pointer;",
    "    }",
    "    button:hover {",
    "      background: #6a42a0;",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="login-container">',
    "    <h1>DB Manager</h1>",
    "    <% if (locals.notConfigured) { %>",
    '      <div class="not-configured">503 \\u2014 Database manager password is not configured.</div>',
    "    <% } %>",
    "    <% if (locals.error) { %>",
    '      <div class="error"><%= error %></div>',
    "    <% } %>",
    '    <form method="POST" action="/database/login">',
    '      <label for="password">Password</label>',
    '      <input type="password" id="password" name="password" required>',
    '      <button type="submit">Login</button>',
    "    </form>",
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Generate the manager page EJS template content string.
 * Returns a complete HTML page with dark theme, left sidebar with table list,
 * three tabs (Structure, Data, Query), and inline vanilla JavaScript for
 * all client-side interactivity.
 *
 * @returns {string}
 */
function generateManagerTemplate() {
  var lines = [];
  function p(s) {
    lines.push(s);
  }

  // HTML head
  p("<!DOCTYPE html>");
  p('<html lang="en">');
  p("<head>");
  p('  <meta charset="UTF-8">');
  p('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  p("  <title>DB Manager</title>");
  p("  <style>");
  p("    * { margin: 0; padding: 0; box-sizing: border-box; }");
  p("    body {");
  p(
    '      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
  );
  p(
    "      background: #1a1a2e; color: #e0e0e0; display: flex; min-height: 100vh;",
  );
  p("    }");
  p(
    "    .sidebar { width: 240px; min-width: 240px; background: #16213e; border-right: 1px solid #2a2a4a; display: flex; flex-direction: column; overflow: hidden; }",
  );
  p("    .sidebar-header { padding: 1rem; border-bottom: 1px solid #2a2a4a; }");
  p(
    "    .sidebar-header h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #e0e0e0; }",
  );
  p(
    "    .sidebar-header input { width: 100%; padding: 0.5rem; border: 1px solid #2a2a4a; border-radius: 4px; background: #0f3460; color: #e0e0e0; font-size: 0.875rem; }",
  );
  p(
    "    .sidebar-header input:focus { outline: none; border-color: #533483; }",
  );
  p("    .table-list { flex: 1; overflow-y: auto; list-style: none; }");
  p(
    "    .table-list li { padding: 0.6rem 1rem; cursor: pointer; border-bottom: 1px solid #2a2a4a; font-size: 0.875rem; transition: background 0.15s; }",
  );
  p("    .table-list li:hover { background: #0f3460; }");
  p("    .table-list li.active { background: #533483; color: #fff; }");
  p(
    "    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }",
  );
  p(
    "    .main-header { padding: 1rem; background: #16213e; border-bottom: 1px solid #2a2a4a; }",
  );
  p("    .main-header h1 { font-size: 1.25rem; color: #e0e0e0; }");
  p(
    "    .tabs { display: flex; background: #16213e; border-bottom: 1px solid #2a2a4a; }",
  );
  p(
    "    .tab-btn { padding: 0.75rem 1.5rem; background: none; border: none; color: #b0b0b0; cursor: pointer; font-size: 0.9rem; border-bottom: 2px solid transparent; width: auto; }",
  );
  p("    .tab-btn:hover { color: #e0e0e0; }");
  p("    .tab-btn.active { color: #e0e0e0; border-bottom-color: #533483; }");
  p(
    "    .tab-content { display: none; flex: 1; overflow: auto; padding: 1rem; }",
  );
  p("    .tab-content.active { display: block; }");
  p(
    "    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }",
  );
  p(
    "    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #2a2a4a; }",
  );
  p(
    "    th { background: #0f3460; color: #e0e0e0; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }",
  );
  p("    th:hover { background: #12407a; }");
  p("    td { background: #16213e; color: #d0d0d0; }");
  p("    tr:hover td { background: #1a2a4e; }");
  p(
    "    .btn { padding: 0.4rem 0.8rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; color: #fff; width: auto; }",
  );
  p("    .btn-primary { background: #533483; }");
  p("    .btn-primary:hover { background: #6a42a0; }");
  p("    .btn-danger { background: #e74c3c; }");
  p("    .btn-danger:hover { background: #c0392b; }");
  p("    .btn-success { background: #27ae60; }");
  p("    .btn-success:hover { background: #219a52; }");
  p("    .btn-secondary { background: #555; }");
  p("    .btn-secondary:hover { background: #666; }");
  p(
    "    .data-toolbar { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }",
  );
  p(
    "    .pagination { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }",
  );
  p(
    "    .pagination select, .pagination span { font-size: 0.8rem; color: #e0e0e0; }",
  );
  p(
    "    .pagination select { background: #0f3460; border: 1px solid #2a2a4a; color: #e0e0e0; padding: 0.25rem; border-radius: 4px; }",
  );
  p(
    "    .filter-row input { width: 100%; padding: 0.3rem 0.5rem; background: #0f3460; border: 1px solid #2a2a4a; border-radius: 4px; color: #e0e0e0; font-size: 0.8rem; }",
  );
  p("    .filter-row input:focus { outline: none; border-color: #533483; }");
  p(
    "    .query-area { width: 100%; min-height: 120px; padding: 0.75rem; background: #0f3460; border: 1px solid #2a2a4a; border-radius: 4px; color: #e0e0e0; font-family: monospace; font-size: 0.875rem; resize: vertical; margin-bottom: 0.75rem; }",
  );
  p("    .query-area:focus { outline: none; border-color: #533483; }");
  p(
    "    .query-error { background: #e74c3c; color: #fff; padding: 0.75rem; border-radius: 4px; margin-top: 0.75rem; }",
  );
  p(
    '    td input[type="text"], td input[type="number"] { width: 100%; padding: 0.25rem 0.4rem; background: #0f3460; border: 1px solid #2a2a4a; border-radius: 3px; color: #e0e0e0; font-size: 0.8rem; }',
  );
  p(
    "    .add-row-form { background: #0f3460; padding: 1rem; border-radius: 4px; margin-bottom: 0.75rem; display: none; }",
  );
  p(
    "    .add-row-form .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem; margin-bottom: 0.75rem; }",
  );
  p(
    "    .add-row-form label { display: block; font-size: 0.75rem; color: #b0b0b0; margin-bottom: 0.25rem; }",
  );
  p(
    "    .add-row-form input, .add-row-form select { width: 100%; padding: 0.4rem; background: #16213e; border: 1px solid #2a2a4a; border-radius: 3px; color: #e0e0e0; font-size: 0.8rem; }",
  );
  p("    .add-row-form .required-mark { color: #e74c3c; }");
  p(
    "    .message { padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.85rem; }",
  );
  p("    .message-success { background: #27ae60; color: #fff; }");
  p("    .message-error { background: #e74c3c; color: #fff; }");
  p('    input[type="checkbox"] { cursor: pointer; width: auto; }');
  p(
    "    .placeholder { display: flex; align-items: center; justify-content: center; flex: 1; color: #666; font-size: 1.1rem; }",
  );
  p("  </style>");
  p("</head>");
  p("<body>");

  // Sidebar
  p('  <div class="sidebar">');
  p('    <div class="sidebar-header">');
  p("      <h2>Tables</h2>");
  p(
    '      <input type="text" id="tableSearch" placeholder="Search tables..." aria-label="Search tables">',
  );
  p("    </div>");
  p('    <ul class="table-list" id="tableList"></ul>');
  p("  </div>");

  // Main content area
  p('  <div class="main">');
  p('    <div class="main-header">');
  p('      <h1 id="tableTitle">Select a table</h1>');
  p("    </div>");
  p('    <div class="tabs" id="tabBar" style="display:none;">');
  p(
    '      <button class="tab-btn active" data-tab="structure">Structure</button>',
  );
  p('      <button class="tab-btn" data-tab="data">Data</button>');
  p('      <button class="tab-btn" data-tab="query">Query</button>');
  p("    </div>");
  p(
    '    <div id="placeholder" class="placeholder">Choose a table from the sidebar to get started.</div>',
  );

  // Structure tab
  p('    <div class="tab-content active" id="tab-structure">');
  p('      <div id="structureContent"></div>');
  p("    </div>");

  // Data tab
  p('    <div class="tab-content" id="tab-data">');
  p('      <div id="dataMessage"></div>');
  p('      <div class="data-toolbar">');
  p('        <button class="btn btn-primary" id="addRowBtn">Add Row</button>');
  p(
    '        <button class="btn btn-danger" id="deleteSelectedBtn" style="display:none;">Delete Selected</button>',
  );
  p(
    '        <button class="btn btn-secondary" id="downloadCsvBtn">Download CSV</button>',
  );
  p("      </div>");
  p('      <div class="add-row-form" id="addRowForm">');
  p(
    '        <h3 style="margin-bottom:0.75rem;font-size:0.95rem;">Add New Row</h3>',
  );
  p('        <div class="form-grid" id="addRowFields"></div>');
  p(
    '        <div id="addRowError" class="message message-error" style="display:none;"></div>',
  );
  p('        <div style="display:flex;gap:0.5rem;">');
  p(
    '          <button class="btn btn-success" id="addRowSubmit">Insert</button>',
  );
  p(
    '          <button class="btn btn-secondary" id="addRowCancel">Cancel</button>',
  );
  p("        </div>");
  p("      </div>");
  p('      <div id="dataTableContainer"></div>');
  p(
    '      <div class="pagination" id="paginationControls" style="display:none;">',
  );
  p('        <button class="btn btn-secondary" id="prevPageBtn">Prev</button>');
  p('        <span id="pageInfo"></span>');
  p('        <button class="btn btn-secondary" id="nextPageBtn">Next</button>');
  p(
    '        <label style="margin-left:0.5rem;font-size:0.8rem;color:#b0b0b0;">',
  );
  p("          Page size:");
  p('          <select id="pageSizeSelect">');
  p('            <option value="10">10</option>');
  p('            <option value="30" selected>30</option>');
  p('            <option value="50">50</option>');
  p('            <option value="100">100</option>');
  p("          </select>");
  p("        </label>");
  p("      </div>");
  p("    </div>");

  // Query tab
  p('    <div class="tab-content" id="tab-query">');
  p(
    '      <textarea class="query-area" id="queryInput" placeholder="Enter SQL query..." aria-label="SQL query input"></textarea>',
  );
  p(
    '      <button class="btn btn-primary" id="executeQueryBtn">Execute</button>',
  );
  p(
    '      <div id="queryError" style="display:none;" class="query-error"></div>',
  );
  p('      <div id="queryResults" style="margin-top:0.75rem;"></div>');
  p("    </div>");
  p("  </div>");

  // --- Inline JavaScript ---
  p("  <script>");
  _appendManagerScript(p);
  p("  </script>");
  p("</body>");
  p("</html>");

  return lines.join("\n");
}

/**
 * Internal helper: pushes inline JavaScript lines for the manager template.
 * @param {function} p - push function that appends a line
 */
function _appendManagerScript(p) {
  // State variables
  p("    var currentTable = null;");
  p("    var columns = [];");
  p("    var pkColumn = null;");
  p("    var currentPage = 1;");
  p("    var pageSize = 30;");
  p("    var sortColumn = null;");
  p('    var sortDir = "asc";');
  p("    var selectedRows = new Set();");
  p("    var allTables = [];");
  p("");

  // DOM references
  p('    var tableListEl = document.getElementById("tableList");');
  p('    var tableSearchEl = document.getElementById("tableSearch");');
  p('    var tableTitleEl = document.getElementById("tableTitle");');
  p('    var tabBar = document.getElementById("tabBar");');
  p('    var placeholderEl = document.getElementById("placeholder");');
  p('    var structureContent = document.getElementById("structureContent");');
  p(
    '    var dataTableContainer = document.getElementById("dataTableContainer");',
  );
  p('    var dataMessage = document.getElementById("dataMessage");');
  p(
    '    var paginationControls = document.getElementById("paginationControls");',
  );
  p('    var pageInfo = document.getElementById("pageInfo");');
  p('    var pageSizeSelect = document.getElementById("pageSizeSelect");');
  p(
    '    var deleteSelectedBtn = document.getElementById("deleteSelectedBtn");',
  );
  p('    var addRowFormEl = document.getElementById("addRowForm");');
  p('    var addRowFields = document.getElementById("addRowFields");');
  p('    var addRowError = document.getElementById("addRowError");');
  p('    var queryInput = document.getElementById("queryInput");');
  p('    var queryError = document.getElementById("queryError");');
  p('    var queryResults = document.getElementById("queryResults");');
  p("");

  // escapeHtml helper
  p("    function escapeHtml(str) {");
  p('      var d = document.createElement("div");');
  p("      d.appendChild(document.createTextNode(str));");
  p("      return d.innerHTML;");
  p("    }");
  p("");

  // showDataMessage helper
  p("    function showDataMessage(msg, type) {");
  p(
    "      dataMessage.innerHTML = '<div class=\"message message-' + type + '\">' + escapeHtml(msg) + '</div>';",
  );
  p("      setTimeout(function() { dataMessage.innerHTML = ''; }, 4000);");
  p("    }");
  p("");

  // --- Sidebar: load tables ---
  p("    function loadTables() {");
  p('      fetch("/database/tables")');
  p("        .then(function(r) { return r.json(); })");
  p("        .then(function(data) {");
  p("          allTables = data.tables || [];");
  p("          renderTableList(allTables);");
  p("        });");
  p("    }");
  p("");

  p("    function renderTableList(tables) {");
  p('      tableListEl.innerHTML = "";');
  p("      tables.forEach(function(t) {");
  p('        var li = document.createElement("li");');
  p("        li.textContent = t;");
  p('        if (t === currentTable) li.className = "active";');
  p('        li.addEventListener("click", function() { selectTable(t); });');
  p("        tableListEl.appendChild(li);");
  p("      });");
  p("    }");
  p("");

  // Sidebar search filter
  p('    tableSearchEl.addEventListener("input", function() {');
  p("      var q = tableSearchEl.value.toLowerCase();");
  p("      var filtered = allTables.filter(function(t) {");
  p("        return t.toLowerCase().indexOf(q) !== -1;");
  p("      });");
  p("      renderTableList(filtered);");
  p("    });");
  p("");

  // --- Tab switching ---
  p('    document.querySelectorAll(".tab-btn").forEach(function(btn) {');
  p('      btn.addEventListener("click", function() {');
  p(
    '        document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });',
  );
  p(
    '        document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });',
  );
  p('        btn.classList.add("active");');
  p('        var tab = btn.getAttribute("data-tab");');
  p('        document.getElementById("tab-" + tab).classList.add("active");');
  p("      });");
  p("    });");
  p("");

  // --- Select table ---
  p("    function selectTable(name) {");
  p("      currentTable = name;");
  p("      currentPage = 1;");
  p("      sortColumn = null;");
  p('      sortDir = "asc";');
  p("      selectedRows = new Set();");
  p("      tableTitleEl.textContent = name;");
  p('      tabBar.style.display = "flex";');
  p('      placeholderEl.style.display = "none";');
  p("      renderTableList(allTables.filter(function(t) {");
  p("        var q = tableSearchEl.value.toLowerCase();");
  p("        return t.toLowerCase().indexOf(q) !== -1;");
  p("      }));");
  p("      loadStructure();");
  p("      loadData();");
  p("    }");
  p("");

  // --- Structure tab ---
  p("    function loadStructure() {");
  p(
    '      fetch("/database/tables/" + encodeURIComponent(currentTable) + "?schema=true")',
  );
  p("        .then(function(r) { return r.json(); })");
  p("        .then(function(data) {");
  p("          columns = data.columns || [];");
  p("          pkColumn = data.pk || null;");
  p("          renderStructure();");
  p("          renderAddRowForm();");
  p("        });");
  p("    }");
  p("");

  p("    function renderStructure() {");
  p('      var html = "<table><thead><tr>";');
  p(
    '      html += "<th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>PK</th>";',
  );
  p('      html += "</tr></thead><tbody>";');
  p("      columns.forEach(function(col) {");
  p('        html += "<tr>";');
  p('        html += "<td>" + escapeHtml(col.name) + "</td>";');
  p('        html += "<td>" + escapeHtml(col.type) + "</td>";');
  p('        html += "<td>" + (col.nullable ? "Yes" : "No") + "</td>";');
  p(
    '        html += "<td>" + (col.default !== null && col.default !== undefined ? escapeHtml(String(col.default)) : "NULL") + "</td>";',
  );
  p('        html += "<td>" + (col.pk ? "Yes" : "No") + "</td>";');
  p('        html += "</tr>";');
  p("      });");
  p('      html += "</tbody></table>";');
  p("      structureContent.innerHTML = html;");
  p("    }");
  p("");

  // --- Data tab ---
  p("    function buildDataParams() {");
  p('      var params = "?page=" + currentPage + "&size=" + pageSize;');
  p("      if (sortColumn) {");
  p(
    '        params += "&sort=" + encodeURIComponent(sortColumn) + "&dir=" + sortDir;',
  );
  p("      }");
  p(
    '      document.querySelectorAll(".filter-row input").forEach(function(input) {',
  );
  p("        var val = input.value.trim();");
  p("        if (val) {");
  p(
    '          params += "&" + encodeURIComponent(input.dataset.column) + "=" + encodeURIComponent("%" + val + "%");',
  );
  p("        }");
  p("      });");
  p("      return params;");
  p("    }");
  p("");

  p("    function loadData() {");
  p("      var params = buildDataParams();");
  p(
    '      fetch("/database/tables/" + encodeURIComponent(currentTable) + params)',
  );
  p("        .then(function(r) { return r.json(); })");
  p("        .then(function(data) {");
  p("          renderDataTable(data);");
  p("          renderPagination(data);");
  p("          selectedRows = new Set();");
  p("          updateDeleteBtn();");
  p("        });");
  p("    }");
  p("");

  p("    function renderDataTable(data) {");
  p("      if (!data.data || data.data.length === 0) {");
  p(
    "        dataTableContainer.innerHTML = '<p style=\"color:#666;padding:1rem;\">No data found.</p>';",
  );
  p("        return;");
  p("      }");
  p(
    "      var cols = columns.length > 0 ? columns.map(function(c) { return c.name; }) : Object.keys(data.data[0]);",
  );
  p('      var html = "<table><thead><tr>";');
  p('      html += \'<th><input type="checkbox" id="selectAll"></th>\';');
  p("      cols.forEach(function(col) {");
  p('        var arrow = "";');
  p(
    "        if (sortColumn === col) arrow = sortDir === 'asc' ? ' \\u2191' : ' \\u2193';",
  );
  p(
    "        html += '<th data-col=\"' + escapeHtml(col) + '\">' + escapeHtml(col) + arrow + '</th>';",
  );
  p("      });");
  p("      html += '<th>Actions</th></tr>';");
  p("      // Filter row");
  p("      html += '<tr class=\"filter-row\"><td></td>';");
  p("      cols.forEach(function(col) {");
  p(
    '        html += \'<td><input type="text" data-column="\' + escapeHtml(col) + \'" placeholder="Filter..."></td>\';',
  );
  p("      });");
  p("      html += '<td></td></tr></thead><tbody>';");
  p("      data.data.forEach(function(row) {");
  p('        var pkVal = pkColumn ? row[pkColumn] : "";');
  p("        html += '<tr data-pk=\"' + escapeHtml(String(pkVal)) + '\">';");
  p(
    '        html += \'<td><input type="checkbox" class="row-check" value="\' + escapeHtml(String(pkVal)) + \'"></td>\';',
  );
  p("        cols.forEach(function(col) {");
  p(
    '          var val = row[col] !== null && row[col] !== undefined ? String(row[col]) : "";',
  );
  p(
    "          html += '<td class=\"data-cell\" data-col=\"' + escapeHtml(col) + '\">' + escapeHtml(val) + '</td>';",
  );
  p("        });");
  p(
    "        html += '<td><button class=\"btn btn-primary edit-btn\">Edit</button></td>';",
  );
  p("        html += '</tr>';");
  p("      });");
  p("      html += '</tbody></table>';");
  p("      dataTableContainer.innerHTML = html;");
  p("");
  p("      // Select all checkbox");
  p('      var selectAllCb = document.getElementById("selectAll");');
  p("      if (selectAllCb) {");
  p('        selectAllCb.addEventListener("change", function() {');
  p('          document.querySelectorAll(".row-check").forEach(function(cb) {');
  p("            cb.checked = selectAllCb.checked;");
  p("            if (cb.checked) selectedRows.add(cb.value);");
  p("            else selectedRows.delete(cb.value);");
  p("          });");
  p("          updateDeleteBtn();");
  p("        });");
  p("      }");
  p("      // Row checkboxes");
  p('      document.querySelectorAll(".row-check").forEach(function(cb) {');
  p('        cb.addEventListener("change", function() {');
  p("          if (cb.checked) selectedRows.add(cb.value);");
  p("          else selectedRows.delete(cb.value);");
  p("          updateDeleteBtn();");
  p("        });");
  p("      });");
  p("      // Sort headers");
  p(
    '      document.querySelectorAll("#tab-data th[data-col]").forEach(function(th) {',
  );
  p('        th.addEventListener("click", function() {');
  p('          var col = th.getAttribute("data-col");');
  p("          if (sortColumn === col) {");
  p('            sortDir = sortDir === "asc" ? "desc" : "asc";');
  p("          } else {");
  p("            sortColumn = col;");
  p('            sortDir = "asc";');
  p("          }");
  p("          loadData();");
  p("        });");
  p("      });");
  p("      // Filter inputs debounce");
  p(
    '      document.querySelectorAll(".filter-row input").forEach(function(input) {',
  );
  p("        var timer;");
  p('        input.addEventListener("input", function() {');
  p("          clearTimeout(timer);");
  p(
    "          timer = setTimeout(function() { currentPage = 1; loadData(); }, 400);",
  );
  p("        });");
  p("      });");
  p("      // Edit buttons");
  p('      document.querySelectorAll(".edit-btn").forEach(function(btn) {');
  p('        btn.addEventListener("click", function() {');
  p('          startEdit(btn.closest("tr"));');
  p("        });");
  p("      });");
  p("    }");
  p("");

  // Pagination
  p("    function renderPagination(data) {");
  p("      var total = data.total || 0;");
  p("      var totalPages = Math.max(1, Math.ceil(total / pageSize));");
  p(
    '      pageInfo.textContent = "Page " + currentPage + " of " + totalPages + " (" + total + " rows)";',
  );
  p('      paginationControls.style.display = "flex";');
  p("    }");
  p("");
  p(
    '    document.getElementById("prevPageBtn").addEventListener("click", function() {',
  );
  p("      if (currentPage > 1) { currentPage--; loadData(); }");
  p("    });");
  p(
    '    document.getElementById("nextPageBtn").addEventListener("click", function() {',
  );
  p("      currentPage++; loadData();");
  p("    });");
  p('    pageSizeSelect.addEventListener("change", function() {');
  p("      pageSize = parseInt(pageSizeSelect.value, 10);");
  p("      currentPage = 1;");
  p("      loadData();");
  p("    });");
  p("");

  // Delete selected button visibility
  p("    function updateDeleteBtn() {");
  p(
    '      deleteSelectedBtn.style.display = selectedRows.size > 0 ? "inline-block" : "none";',
  );
  p("    }");
  p("");

  // --- Delete selected ---
  p('    deleteSelectedBtn.addEventListener("click", function() {');
  p("      var count = selectedRows.size;");
  p(
    "      if (!confirm('Are you sure you want to delete ' + count + ' row(s)?')) return;",
  );
  p("      var keys = Array.from(selectedRows);");
  p('      fetch("/database/tables/" + encodeURIComponent(currentTable), {');
  p('        method: "DELETE",');
  p('        headers: { "Content-Type": "application/json" },');
  p("        body: JSON.stringify({ keys: keys })");
  p("      })");
  p(
    "        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })",
  );
  p("        .then(function(res) {");
  p("          if (res.ok) {");
  p(
    "            showDataMessage('Deleted ' + (res.data.deleted || count) + ' row(s).', 'success');",
  );
  p("            selectedRows = new Set();");
  p("            loadData();");
  p("          } else {");
  p(
    "            showDataMessage(res.data.error || 'Delete failed.', 'error');",
  );
  p("          }");
  p("        });");
  p("    });");
  p("");

  // --- Inline edit ---
  p("    function startEdit(tr) {");
  p('      var cells = tr.querySelectorAll(".data-cell");');
  p("      var originalValues = {};");
  p("      cells.forEach(function(cell) {");
  p('        var col = cell.getAttribute("data-col");');
  p("        originalValues[col] = cell.textContent;");
  p('        var input = document.createElement("input");');
  p('        input.type = "text";');
  p("        input.value = cell.textContent;");
  p("        input.dataset.col = col;");
  p('        cell.textContent = "";');
  p("        cell.appendChild(input);");
  p("      });");
  p('      var actionsCell = tr.querySelector("td:last-child");');
  p('      actionsCell.innerHTML = "";');
  p('      var saveBtn = document.createElement("button");');
  p('      saveBtn.className = "btn btn-success";');
  p('      saveBtn.textContent = "Save";');
  p('      var cancelBtn = document.createElement("button");');
  p('      cancelBtn.className = "btn btn-secondary";');
  p('      cancelBtn.textContent = "Cancel";');
  p('      cancelBtn.style.marginLeft = "0.25rem";');
  p("      actionsCell.appendChild(saveBtn);");
  p("      actionsCell.appendChild(cancelBtn);");
  p("");
  p('      cancelBtn.addEventListener("click", function() {');
  p("        cells.forEach(function(cell) {");
  p('          var col = cell.getAttribute("data-col");');
  p("          cell.textContent = originalValues[col];");
  p("        });");
  p(
    "        actionsCell.innerHTML = '<button class=\"btn btn-primary edit-btn\">Edit</button>';",
  );
  p(
    '        actionsCell.querySelector(".edit-btn").addEventListener("click", function() { startEdit(tr); });',
  );
  p("      });");
  p("");
  p('      saveBtn.addEventListener("click", function() {');
  p('        var pkVal = tr.getAttribute("data-pk");');
  p("        var body = {};");
  p("        cells.forEach(function(cell) {");
  p('          var input = cell.querySelector("input");');
  p("          if (input) body[input.dataset.col] = input.value;");
  p("        });");
  p(
    '        fetch("/database/tables/" + encodeURIComponent(currentTable) + "/" + encodeURIComponent(pkVal), {',
  );
  p('          method: "PUT",');
  p('          headers: { "Content-Type": "application/json" },');
  p("          body: JSON.stringify(body)");
  p("        })");
  p(
    "          .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })",
  );
  p("          .then(function(res) {");
  p("            if (res.ok) {");
  p("              showDataMessage('Row updated successfully.', 'success');");
  p("              loadData();");
  p("            } else {");
  p(
    "              showDataMessage(res.data.error || 'Update failed.', 'error');",
  );
  p("            }");
  p("          });");
  p("      });");
  p("    }");
  p("");

  // --- Add row form ---
  p("    function renderAddRowForm() {");
  p('      addRowFields.innerHTML = "";');
  p("      columns.forEach(function(col) {");
  p('        var div = document.createElement("div");');
  p('        var label = document.createElement("label");');
  p("        label.textContent = col.name;");
  p("        if (!col.nullable && !col.pk) {");
  p('          var mark = document.createElement("span");');
  p('          mark.className = "required-mark";');
  p('          mark.textContent = " *";');
  p("          label.appendChild(mark);");
  p("        }");
  p("        div.appendChild(label);");
  p("        var input;");
  p('        var colType = (col.type || "").toLowerCase();');
  p("        if (colType.indexOf('bool') !== -1) {");
  p('          input = document.createElement("select");');
  p(
    '          var optEmpty = document.createElement("option"); optEmpty.value = ""; optEmpty.textContent = "-- select --";',
  );
  p(
    '          var optTrue = document.createElement("option"); optTrue.value = "true"; optTrue.textContent = "true";',
  );
  p(
    '          var optFalse = document.createElement("option"); optFalse.value = "false"; optFalse.textContent = "false";',
  );
  p(
    "          input.appendChild(optEmpty); input.appendChild(optTrue); input.appendChild(optFalse);",
  );
  p(
    "        } else if (colType.indexOf('int') !== -1 || colType.indexOf('numeric') !== -1 || colType.indexOf('decimal') !== -1 || colType.indexOf('float') !== -1 || colType.indexOf('double') !== -1 || colType.indexOf('real') !== -1) {",
  );
  p('          input = document.createElement("input");');
  p('          input.type = "number";');
  p('          input.step = "any";');
  p("        } else {");
  p('          input = document.createElement("input");');
  p('          input.type = "text";');
  p("        }");
  p("        input.dataset.column = col.name;");
  p("        div.appendChild(input);");
  p("        addRowFields.appendChild(div);");
  p("      });");
  p("    }");
  p("");

  p(
    '    document.getElementById("addRowBtn").addEventListener("click", function() {',
  );
  p('      addRowFormEl.style.display = "block";');
  p('      addRowError.style.display = "none";');
  p("    });");
  p(
    '    document.getElementById("addRowCancel").addEventListener("click", function() {',
  );
  p('      addRowFormEl.style.display = "none";');
  p('      addRowError.style.display = "none";');
  p("    });");
  p(
    '    document.getElementById("addRowSubmit").addEventListener("click", function() {',
  );
  p("      var body = {};");
  p(
    '      addRowFields.querySelectorAll("input, select").forEach(function(el) {',
  );
  p("        var val = el.value;");
  p('        if (val !== "") body[el.dataset.column] = val;');
  p("      });");
  p('      fetch("/database/tables/" + encodeURIComponent(currentTable), {');
  p('        method: "POST",');
  p('        headers: { "Content-Type": "application/json" },');
  p("        body: JSON.stringify(body)");
  p("      })");
  p(
    "        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })",
  );
  p("        .then(function(res) {");
  p("          if (res.ok) {");
  p('            addRowFormEl.style.display = "none";');
  p("            showDataMessage('Row inserted successfully.', 'success');");
  p("            loadData();");
  p("          } else {");
  p(
    "            addRowError.textContent = res.data.error || 'Insert failed.';",
  );
  p('            addRowError.style.display = "block";');
  p("          }");
  p("        });");
  p("    });");
  p("");

  // --- CSV download ---
  p(
    '    document.getElementById("downloadCsvBtn").addEventListener("click", function() {',
  );
  p(
    '      var url = "/database/tables/" + encodeURIComponent(currentTable) + "/csv";',
  );
  p("      if (selectedRows.size > 0) {");
  p(
    '        url += "?ids=" + encodeURIComponent(Array.from(selectedRows).join(","));',
  );
  p("      }");
  p("      window.location.href = url;");
  p("    });");
  p("");

  // --- Query tab ---
  p(
    '    document.getElementById("executeQueryBtn").addEventListener("click", function() {',
  );
  p("      var sql = queryInput.value.trim();");
  p("      if (!sql) return;");
  p('      queryError.style.display = "none";');
  p('      queryResults.innerHTML = "";');
  p('      fetch("/database/query", {');
  p('        method: "POST",');
  p('        headers: { "Content-Type": "application/json" },');
  p("        body: JSON.stringify({ sql: sql })");
  p("      })");
  p(
    "        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })",
  );
  p("        .then(function(res) {");
  p("          if (!res.ok) {");
  p("            queryError.textContent = res.data.error || 'Query failed.';");
  p('            queryError.style.display = "block";');
  p("            return;");
  p("          }");
  p("          var rows = res.data.data || [];");
  p("          if (rows.length === 0) {");
  p(
    "            queryResults.innerHTML = '<p style=\"color:#b0b0b0;\">Query executed. ' + (res.data.rowCount || 0) + ' row(s) affected.</p>';",
  );
  p("            return;");
  p("          }");
  p("          var keys = Object.keys(rows[0]);");
  p('          var html = "<table><thead><tr>";');
  p(
    "          keys.forEach(function(k) { html += '<th>' + escapeHtml(k) + '</th>'; });",
  );
  p('          html += "</tr></thead><tbody>";');
  p("          rows.forEach(function(row) {");
  p('            html += "<tr>";');
  p("            keys.forEach(function(k) {");
  p(
    '              var v = row[k] !== null && row[k] !== undefined ? String(row[k]) : "";',
  );
  p("              html += '<td>' + escapeHtml(v) + '</td>';");
  p("            });");
  p('            html += "</tr>";');
  p("          });");
  p('          html += "</tbody></table>";');
  p("          queryResults.innerHTML = html;");
  p("        });");
  p("    });");
  p("");

  // Init
  p("    loadTables();");
}

/**
 * Generate the route handler content string for routes/database.js.
 * Returns an ES module string implementing all DB Manager API endpoints.
 *
 * @returns {string}
 */
function generateDbManagerRoute() {
  var lines = [];
  function p(s) {
    lines.push(s);
  }

  // Imports
  p('import express from "express";');
  p('import dbManagerAuth from "../middleware/db-manager-auth.js";');
  p("");
  p("const router = express.Router();");
  p("");

  // --- Login routes (no auth) ---
  p("// GET /login — render login page");
  p('router.get("/login", (req, res) => {');
  p("  if (!process.env.DATABASE_MANAGER_PASSWORD) {");
  p(
    '    return res.status(503).render("db-manager/login", { notConfigured: true });',
  );
  p("  }");
  p('  res.render("db-manager/login");');
  p("});");
  p("");

  p("// POST /login — authenticate with password");
  p('router.post("/login", (req, res) => {');
  p("  const configuredPassword = process.env.DATABASE_MANAGER_PASSWORD;");
  p("  if (!configuredPassword) {");
  p(
    '    return res.status(503).render("db-manager/login", { notConfigured: true });',
  );
  p("  }");
  p("  const { password } = req.body;");
  p("  if (password === configuredPassword) {");
  p('    req.session["db-manager"] = true;');
  p('    return res.redirect("/database");');
  p("  }");
  p('  res.render("db-manager/login", { error: "Invalid password" });');
  p("});");
  p("");

  // --- Apply auth middleware to all remaining routes ---
  p("// Auth middleware for all routes below");
  p("router.use(dbManagerAuth);");
  p("");

  // --- GET / — render manager page ---
  p("// GET / — render manager page");
  p('router.get("/", (req, res) => {');
  p('  res.render("db-manager/manager");');
  p("});");
  p("");

  // --- GET /tables — list all table names ---
  p("// GET /tables — list all table names");
  p('router.get("/tables", async (req, res) => {');
  p("  try {");
  p(
    "    const result = await global.db.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' OR table_type = 'BASE TABLE' ORDER BY table_name\");",
  );
  p("    const rows = result.rows || result || [];");
  p(
    "    const tables = rows.map((r) => r.table_name || r.TABLE_NAME || r.name || Object.values(r)[0]);",
  );
  p("    res.json({ tables });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- Helper: get primary key column for a table ---
  p("// Helper: get primary key column for a table");
  p("async function getPrimaryKey(tableName) {");
  p("  try {");
  p("    const result = await global.db.query(");
  p(
    "      \"SELECT column_name FROM information_schema.key_column_usage WHERE table_name = '\" + tableName + \"' AND constraint_name LIKE '%pkey%' OR (table_name = '\" + tableName + \"' AND constraint_name LIKE '%PRIMARY%') LIMIT 1\"",
  );
  p("    );");
  p("    const rows = result.rows || result || [];");
  p("    if (rows.length > 0) {");
  p(
    "      return rows[0].column_name || rows[0].COLUMN_NAME || Object.values(rows[0])[0];",
  );
  p("    }");
  p("  } catch (e) {");
  p("    // fallback");
  p("  }");
  p('  return "id";');
  p("}");
  p("");

  // --- Helper: get column schema for a table ---
  p("// Helper: get column schema for a table");
  p("async function getTableSchema(tableName) {");
  p("  const result = await global.db.query(");
  p(
    '    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = \'" + tableName + "\' ORDER BY ordinal_position"',
  );
  p("  );");
  p("  const rows = result.rows || result || [];");
  p("  const pk = await getPrimaryKey(tableName);");
  p("  const columns = rows.map((r) => ({");
  p("    name: r.column_name || r.COLUMN_NAME || Object.values(r)[0],");
  p('    type: r.data_type || r.DATA_TYPE || "",');
  p('    nullable: (r.is_nullable || r.IS_NULLABLE || "YES") === "YES",');
  p("    default: r.column_default || r.COLUMN_DEFAULT || null,");
  p("    pk: (r.column_name || r.COLUMN_NAME || Object.values(r)[0]) === pk,");
  p("  }));");
  p("  return { columns, pk };");
  p("}");
  p("");

  // --- GET /tables/:table_name — get table data or schema ---
  p("// GET /tables/:table_name — get table data or schema");
  p('router.get("/tables/:table_name", async (req, res) => {');
  p("  const tableName = req.params.table_name;");
  p("  try {");
  p("    // Schema mode");
  p('    if (req.query.schema === "true") {');
  p("      const schema = await getTableSchema(tableName);");
  p("      return res.json(schema);");
  p("    }");
  p("");
  p("    // Data mode");
  p("    const page = parseInt(req.query.page, 10) || 1;");
  p("    const size = parseInt(req.query.size, 10) || 30;");
  p("    const sort = req.query.sort;");
  p('    const dir = req.query.dir === "desc" ? "DESC" : "ASC";');
  p("    const offset = (page - 1) * size;");
  p("    const pk = await getPrimaryKey(tableName);");
  p("");
  p("    // Build WHERE clause from filter params");
  p("    const filterKeys = Object.keys(req.query).filter(");
  p('      (k) => !["page", "size", "sort", "dir", "schema"].includes(k)');
  p("    );");
  p('    let where = "";');
  p("    if (filterKeys.length > 0) {");
  p("      const conditions = filterKeys.map(");
  p(
    '        (k) => k + " LIKE \'" + String(req.query[k]).replace(/\'/g, "\'\'") + "\'"',
  );
  p("      );");
  p('      where = " WHERE " + conditions.join(" AND ");');
  p("    }");
  p("");
  p('    let orderBy = "";');
  p("    if (sort) {");
  p('      orderBy = " ORDER BY " + sort + " " + dir;');
  p("    }");
  p("");
  p("    // Count total");
  p(
    '    const countResult = await global.db.query("SELECT COUNT(*) as count FROM " + tableName + where);',
  );
  p("    const countRows = countResult.rows || countResult || [];");
  p(
    "    const total = parseInt(countRows[0].count || countRows[0].COUNT || Object.values(countRows[0])[0], 10) || 0;",
  );
  p("");
  p("    // Fetch rows");
  p(
    '    const dataResult = await global.db.query("SELECT * FROM " + tableName + where + orderBy + " LIMIT " + size + " OFFSET " + offset);',
  );
  p("    const data = dataResult.rows || dataResult || [];");
  p("");
  p("    res.json({ data, total, page, size, pk });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- GET /tables/:table_name/csv — download table data as CSV ---
  p("// GET /tables/:table_name/csv — download table data as CSV");
  p('router.get("/tables/:table_name/csv", async (req, res) => {');
  p("  const tableName = req.params.table_name;");
  p("  try {");
  p("    const pk = await getPrimaryKey(tableName);");
  p('    let query = "SELECT * FROM " + tableName;');
  p("");
  p("    // Filter by specific IDs if provided");
  p("    if (req.query.ids) {");
  p(
    '      const ids = req.query.ids.split(",").map((id) => "\'" + String(id).replace(/\'/g, "\'\'") + "\'").join(",");',
  );
  p('      query += " WHERE " + pk + " IN (" + ids + ")";');
  p("    }");
  p("");
  p("    const result = await global.db.query(query);");
  p("    const rows = result.rows || result || [];");
  p("");
  p("    if (rows.length === 0) {");
  p('      res.setHeader("Content-Type", "text/csv");');
  p(
    '      res.setHeader("Content-Disposition", "attachment; filename=\\"" + tableName + ".csv\\"");',
  );
  p('      return res.send("");');
  p("    }");
  p("");
  p("    const columns = Object.keys(rows[0]);");
  p('    const csvLines = [columns.join(",")];');
  p("    rows.forEach((row) => {");
  p("      const values = columns.map((col) => {");
  p("        const val = row[col];");
  p('        if (val === null || val === undefined) return "";');
  p("        const str = String(val);");
  p(
    '        if (str.includes(",") || str.includes(\'\"\') || str.includes("\\n")) {',
  );
  p("          return '\"' + str.replace(/\"/g, '\"\"') + '\"';");
  p("        }");
  p("        return str;");
  p("      });");
  p('      csvLines.push(values.join(","));');
  p("    });");
  p("");
  p('    res.setHeader("Content-Type", "text/csv");');
  p(
    '    res.setHeader("Content-Disposition", "attachment; filename=\\"" + tableName + ".csv\\"");',
  );
  p('    res.send(csvLines.join("\\n"));');
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- DELETE /tables/:table_name — bulk delete rows ---
  p("// DELETE /tables/:table_name — bulk delete rows by primary key values");
  p('router.delete("/tables/:table_name", async (req, res) => {');
  p("  const tableName = req.params.table_name;");
  p("  try {");
  p("    const { keys } = req.body;");
  p("    if (!keys || !Array.isArray(keys) || keys.length === 0) {");
  p(
    '      return res.status(400).json({ error: "No keys provided for deletion" });',
  );
  p("    }");
  p("    const pk = await getPrimaryKey(tableName);");
  p(
    '    const placeholders = keys.map((k) => "\'" + String(k).replace(/\'/g, "\'\'") + "\'").join(",");',
  );
  p(
    '    const result = await global.db.query("DELETE FROM " + tableName + " WHERE " + pk + " IN (" + placeholders + ")");',
  );
  p(
    "    const deleted = (result && result.rowCount) || (result && result.changes) || keys.length;",
  );
  p("    res.json({ deleted });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- PUT /tables/:table_name/:id — update a single row ---
  p("// PUT /tables/:table_name/:id — update a single row");
  p('router.put("/tables/:table_name/:id", async (req, res) => {');
  p("  const tableName = req.params.table_name;");
  p("  const id = req.params.id;");
  p("  try {");
  p("    const body = req.body;");
  p("    const keys = Object.keys(body);");
  p("    if (keys.length === 0) {");
  p(
    '      return res.status(400).json({ error: "No fields provided for update" });',
  );
  p("    }");
  p("    const pk = await getPrimaryKey(tableName);");
  p("    const setClauses = keys.map(");
  p('      (k) => k + " = \'" + String(body[k]).replace(/\'/g, "\'\'") + "\'"');
  p("    );");
  p(
    '    await global.db.query("UPDATE " + tableName + " SET " + setClauses.join(", ") + " WHERE " + pk + " = \'" + String(id).replace(/\'/g, "\'\'") + "\'");',
  );
  p("");
  p("    // Fetch updated row");
  p(
    '    const result = await global.db.query("SELECT * FROM " + tableName + " WHERE " + pk + " = \'" + String(id).replace(/\'/g, "\'\'") + "\'");',
  );
  p("    const rows = result.rows || result || [];");
  p("    res.json({ data: rows[0] || {} });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- POST /tables/:table_name — insert a new row ---
  p("// POST /tables/:table_name — insert a new row");
  p('router.post("/tables/:table_name", async (req, res) => {');
  p("  const tableName = req.params.table_name;");
  p("  try {");
  p("    const body = req.body;");
  p("    const keys = Object.keys(body);");
  p("    if (keys.length === 0) {");
  p(
    '      return res.status(400).json({ error: "No fields provided for insert" });',
  );
  p("    }");
  p('    const columns = keys.join(", ");');
  p("    const values = keys.map(");
  p('      (k) => "\'" + String(body[k]).replace(/\'/g, "\'\'") + "\'"');
  p('    ).join(", ");');
  p(
    '    await global.db.query("INSERT INTO " + tableName + " (" + columns + ") VALUES (" + values + ")");',
  );
  p("");
  p("    res.status(201).json({ data: body });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  // --- POST /query — execute raw SQL ---
  p("// POST /query — execute raw SQL query");
  p('router.post("/query", async (req, res) => {');
  p("  try {");
  p("    const { sql } = req.body;");
  p("    if (!sql) {");
  p('      return res.status(400).json({ error: "No SQL query provided" });');
  p("    }");
  p("    const result = await global.db.query(sql);");
  p("    const data = result.rows || result || [];");
  p("    const rowCount = Array.isArray(data) ? data.length : 0;");
  p("    res.json({ data, rowCount });");
  p("  } catch (err) {");
  p("    res.status(400).json({ error: err.message });");
  p("  }");
  p("});");
  p("");

  p("export default router;");
  p("");

  return lines.join("\n");
}

/**
 * Append DB Manager password variable to existing .env content.
 * Adds a newline separator and a "# DB Manager" comment before the variable.
 *
 * @param {string} existingEnv - Existing .env file content
 * @returns {string} Modified .env content with DATABASE_MANAGER_PASSWORD appended
 */
function appendDbManagerEnv(existingEnv) {
  return (
    existingEnv.trimEnd() +
    "\n\n# DB Manager\nDATABASE_MANAGER_PASSWORD=admin\n"
  );
}

/**
 * Append DB Manager password placeholder to existing .env.example content.
 * Adds a newline separator and a "# DB Manager" comment before the variable.
 *
 * @param {string} existingEnvExample - Existing .env.example file content
 * @returns {string} Modified .env.example content with DATABASE_MANAGER_PASSWORD appended
 */
function appendDbManagerEnvExample(existingEnvExample) {
  return (
    existingEnvExample.trimEnd() +
    "\n\n# DB Manager\nDATABASE_MANAGER_PASSWORD=your_db_manager_password\n"
  );
}

/**
 * Add the "ejs" dependency to a package.json string.
 * Parses the JSON, adds "ejs" to dependencies, and returns the modified JSON string.
 *
 * @param {string} packageJsonStr - Existing package.json content as a string
 * @returns {string} Modified package.json content with ejs dependency added
 */
function addEjsDependency(packageJsonStr) {
  var pkg = JSON.parse(packageJsonStr);
  if (!pkg.dependencies) {
    pkg.dependencies = {};
  }
  pkg.dependencies["ejs"] = "^3.1.10";
  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Inject DB Manager configuration into existing app.js content.
 * Adds:
 *   - `import path from "path";` at the top (if not already present)
 *   - `import dbManagerRoute from "./routes/database.js";` after other imports
 *   - `app.set("view engine", "ejs");` and `app.set("views", path.join(__dirname, "views"));` after middleware setup
 *   - `app.use("/database", dbManagerRoute);` before the error handler
 *
 * @param {string} appJsContent - Existing app.js content as a string
 * @returns {string} Modified app.js content with DB Manager integration
 */
function addDbManagerToAppJs(appJsContent) {
  var lines = appJsContent.split("\n");
  var result = [];
  var pathImportExists = false;
  var dbManagerRouteImportAdded = false;
  var ejsConfigAdded = false;
  var routeMountAdded = false;

  // Check if path import already exists
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*import\s+path\s+from\s+["']path["']/.test(lines[i])) {
      pathImportExists = true;
      break;
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Add path import at the very top if not present (after the first import)
    if (
      !pathImportExists &&
      !dbManagerRouteImportAdded &&
      /^\s*import\s+/.test(line)
    ) {
      result.push('import path from "path";');
      pathImportExists = true;
    }

    // Find the last import line to add dbManagerRoute import after it
    if (/^\s*import\s+/.test(line) && !dbManagerRouteImportAdded) {
      // Look ahead to see if next non-empty line is not an import
      var nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === "") {
        nextNonEmpty++;
      }
      if (
        nextNonEmpty >= lines.length ||
        !/^\s*import\s+/.test(lines[nextNonEmpty])
      ) {
        result.push(line);
        result.push('import dbManagerRoute from "./routes/database.js";');
        dbManagerRouteImportAdded = true;
        continue;
      }
    }

    // Add EJS config after middleware setup (after app.use(express.urlencoded...))
    if (!ejsConfigAdded && /app\.use\(\s*express\.urlencoded/.test(line)) {
      result.push(line);
      result.push("");
      result.push("// EJS view engine");
      result.push('app.set("view engine", "ejs");');
      result.push('app.set("views", path.join(__dirname, "views"));');
      ejsConfigAdded = true;
      continue;
    }

    // Add route mount before the error handler
    if (
      !routeMountAdded &&
      /app\.use\(\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/.test(line)
    ) {
      result.push("// DB Manager");
      result.push('app.use("/database", dbManagerRoute);');
      result.push("");
      routeMountAdded = true;
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Generate all DB Manager planned files.
 *
 * @param {object} schema - Parsed schema from parseSchema()
 * @param {object} [options]
 * @param {string} [options.envContent] - Existing .env content to append to
 * @param {string} [options.envExampleContent] - Existing .env.example content to append to
 * @param {string} [options.appJsContent] - Existing app.js content to modify
 * @param {string} [options.packageJsonContent] - Existing package.json content to modify
 * @returns {{ files: Array<{ relPath: string, content: string }>, warnings: string[] }}
 */
function generateDbManager(schema, options) {
  options = options || {};

  // SQL adapter guard — skip for NoSQL adapters
  if (!SQL_ADAPTERS.includes(schema.adapter)) {
    return {
      files: [],
      warnings: [
        "DB Manager requires a SQL adapter. Skipping DB Manager generation for adapter: " +
          schema.adapter,
      ],
    };
  }

  var files = [];

  // Core template files (always generated for SQL adapters)
  files.push({
    relPath: "routes/database.js",
    content: generateDbManagerRoute(),
  });

  files.push({
    relPath: "middleware/db-manager-auth.js",
    content: generateDbManagerAuthMiddleware(),
  });

  files.push({
    relPath: "views/db-manager/login.ejs",
    content: generateLoginTemplate(),
  });

  files.push({
    relPath: "views/db-manager/manager.ejs",
    content: generateManagerTemplate(),
  });

  // Optional modifications — only included when the corresponding option is provided
  if (options.envContent) {
    files.push({
      relPath: ".env",
      content: appendDbManagerEnv(options.envContent),
    });
  }

  if (options.envExampleContent) {
    files.push({
      relPath: ".env.example",
      content: appendDbManagerEnvExample(options.envExampleContent),
    });
  }

  if (options.packageJsonContent) {
    files.push({
      relPath: "package.json",
      content: addEjsDependency(options.packageJsonContent),
    });
  }

  if (options.appJsContent) {
    files.push({
      relPath: "app.js",
      content: addDbManagerToAppJs(options.appJsContent),
    });
  }

  return { files: files, warnings: [] };
}

module.exports = {
  SQL_ADAPTERS,
  generateDbManager,
  generateDbManagerAuthMiddleware,
  generateDbManagerRoute,
  generateLoginTemplate,
  generateManagerTemplate,
  appendDbManagerEnv,
  appendDbManagerEnvExample,
  addEjsDependency,
  addDbManagerToAppJs,
};
