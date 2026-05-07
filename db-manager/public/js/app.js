/* DB Manager - Client-Side Application */
/* eslint-env browser */
(function () {
  "use strict";

  // === State ===
  var state = {
    tables: [],
    activeTable: null,
    schema: null,
    rows: [],
    totalCount: 0,
    page: 0,
    limit: 30,
    selectedKeys: [],
    pkColumn: null,
    sortColumn: null,
    sortDir: null,
    filters: [],
  };

  // === DOM References ===
  var tableSearchInput = document.querySelector(".table-search");
  var tableList = document.querySelector(".table-list");
  var historyList = document.querySelector(".history-list");
  var columnHeaders = document.querySelector(".column-headers");
  var dataRows = document.querySelector(".data-rows");
  var btnAdd = document.querySelector(".btn-add");
  var btnDelete = document.querySelector(".btn-delete");
  var btnExport = document.querySelector(".btn-export");
  var btnFilter = document.querySelector(".btn-filter");
  var btnPrev = document.querySelector(".btn-prev");
  var btnNext = document.querySelector(".btn-next");
  var pageInfo = document.querySelector(".page-info");
  var pageSize = document.querySelector(".page-size");
  var filterTagsContainer = document.querySelector(".filter-tags");
  var filterModalOverlay = document.querySelector(".filter-modal-overlay");
  var filterColSelect = document.querySelector(".filter-col-select");
  var filterOpSelect = document.querySelector(".filter-op-select");
  var filterValInput = document.querySelector(".filter-val-input");
  var btnFilterAdd = document.querySelector(".btn-filter-add");
  var filterModalClose = document.querySelector(".filter-modal-close");

  // === Utility: Filter tables (same logic as db-manager/utils/filter-tables.js) ===
  function filterTables(tables, search) {
    if (!search || search.trim() === "") {
      return tables.slice();
    }
    var needle = search.toLowerCase();
    return tables.filter(function (table) {
      return table.toLowerCase().indexOf(needle) !== -1;
    });
  }

  // === Utility: Format cell value ===
  // Converts ISO timestamps (YYYY-MM-DDTHH:mm:ss.000Z) to YYYY-MM-DD HH:mm:ss (UTC)
  function formatCellValue(val) {
    if (val === null || val === undefined) return "";
    var str = String(val);
    // Match ISO 8601 timestamp pattern
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(str)) {
      var d = new Date(str);
      if (!isNaN(d.getTime())) {
        var y = d.getUTCFullYear();
        var m = String(d.getUTCMonth() + 1).padStart(2, "0");
        var day = String(d.getUTCDate()).padStart(2, "0");
        var h = String(d.getUTCHours()).padStart(2, "0");
        var min = String(d.getUTCMinutes()).padStart(2, "0");
        var s = String(d.getUTCSeconds()).padStart(2, "0");
        return y + "-" + m + "-" + day + " " + h + ":" + min + ":" + s;
      }
    }
    return str;
  }

  // === Utility: Debounce ===
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  // === Utility: Encode filter value with operator prefix for library syntax ===
  function encodeFilterValue(operator, value) {
    switch (operator) {
      case "=":
        return encodeURIComponent(value);
      case "!=":
        return encodeURIComponent("!" + value);
      case ">":
        return encodeURIComponent(">" + value);
      case ">=":
        return encodeURIComponent(">=" + value);
      case "<":
        return encodeURIComponent("<" + value);
      case "<=":
        return encodeURIComponent("<=" + value);
      case "like":
        return encodeURIComponent("%" + value + "%");
      case "not like":
        return encodeURIComponent("!%" + value + "%");
      case "in":
        return encodeURIComponent("in(" + value + ")");
      case "not in":
        return encodeURIComponent("!in(" + value + ")");
      default:
        return encodeURIComponent(value);
    }
  }

  // === Utility: Inline nextSortState (matches db-manager/utils/sort-state.js) ===
  function nextSortState(currentColumn, currentDir, clickedColumn) {
    // Clicking a different column → start ascending on new column
    if (clickedColumn !== currentColumn) {
      return { column: clickedColumn, dir: "asc" };
    }
    // Same column clicked — cycle through states
    if (currentDir === null || currentDir === undefined) {
      return { column: clickedColumn, dir: "asc" };
    }
    if (currentDir === "asc") {
      return { column: clickedColumn, dir: "desc" };
    }
    // currentDir === 'desc' → clear sort
    return { column: null, dir: null };
  }

  // === Toast Messages ===
  function showToast(message, type) {
    var container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    var toast = document.createElement("div");
    toast.className = "toast toast-" + (type || "success");
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  // === API Helpers ===
  function apiFetch(url, options) {
    return fetch(url, options)
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.message || "Request failed");
          });
        }
        return res;
      })
      .catch(function (err) {
        showToast(err.message || "Network error", "error");
        throw err;
      });
  }

  function apiGet(url) {
    return apiFetch(url).then(function (res) {
      return res.json();
    });
  }

  function apiPost(url, body) {
    return apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json();
    });
  }

  function apiPut(url, body) {
    return apiFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json();
    });
  }

  function apiDelete(url, body) {
    return apiFetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json();
    });
  }

  // === Sidebar: Fetch and Render Tables ===
  function fetchTables() {
    apiGet("/api/tables").then(function (data) {
      state.tables = data.tables || [];
      renderTableList(state.tables);
    });
  }

  function renderTableList(tables) {
    if (!tableList) return;
    tableList.innerHTML = "";
    var isTablesPage = window.location.pathname === "/tables";
    tables.forEach(function (name) {
      var li = document.createElement("li");
      li.textContent = name;
      li.setAttribute("data-table", name);
      if (name === state.activeTable) {
        li.classList.add("active");
      }
      li.addEventListener("click", function () {
        if (isTablesPage) {
          selectTable(name);
        } else {
          window.location.href = "/tables?table=" + encodeURIComponent(name);
        }
      });
      tableList.appendChild(li);
    });
  }

  // === Table Search ===
  function onTableSearch() {
    var query = tableSearchInput.value;
    var filtered = filterTables(state.tables, query);
    renderTableList(filtered);
  }

  // === Accordion Toggle ===
  function setupAccordion() {
    // Setup sidebar tables toggle
    var tablesToggle = document.querySelector(".sidebar-tables-toggle");
    if (tablesToggle) {
      tablesToggle.addEventListener("click", function () {
        var expanded = tablesToggle.getAttribute("aria-expanded") === "true";
        tablesToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      });
    }
  }

  // === History ===
  function fetchHistory() {
    apiGet("/api/history/connections").then(function (data) {
      var connections = data.connections || [];
      historyList.innerHTML = "";
      connections.forEach(function (conn) {
        var li = document.createElement("li");
        li.textContent =
          conn.db_type +
          " — " +
          conn.database_name +
          " (" +
          conn.connected_at +
          ")";
        historyList.appendChild(li);
      });
    });
  }

  // === Table Selection ===
  function selectTable(name) {
    state.activeTable = name;
    state.page = 0;
    state.selectedKeys = [];
    state.sortColumn = null;
    state.sortDir = null;
    state.filters = [];
    updateSelectionButtons();

    // Highlight active in sidebar
    var items = tableList.querySelectorAll("li");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle(
        "active",
        items[i].getAttribute("data-table") === name,
      );
    }

    // Fetch schema then rows
    apiGet("/api/tables/" + encodeURIComponent(name) + "/schema").then(
      function (schema) {
        state.schema = schema;
        state.pkColumn = schema.pk || null;
        renderColumnHeaders();
        renderFilterTags();
        fetchRows();
      },
    );
  }

  // === Render Column Headers (with sort support) ===
  function renderColumnHeaders() {
    columnHeaders.innerHTML = "";
    // Checkbox header
    var thCheck = document.createElement("th");
    var selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.setAttribute("aria-label", "Select all rows");
    selectAll.addEventListener("change", function () {
      toggleSelectAll(selectAll.checked);
    });
    thCheck.appendChild(selectAll);
    columnHeaders.appendChild(thCheck);

    // Column headers from schema
    if (state.schema && state.schema.columns) {
      state.schema.columns.forEach(function (col) {
        var th = document.createElement("th");
        th.className = "sortable";
        th.setAttribute("data-column", col.name);
        th.textContent = col.name + " ";

        // Add sort indicator
        if (state.sortColumn === col.name && state.sortDir) {
          var icon = document.createElement("span");
          icon.className = "material-icons sort-icon";
          icon.textContent =
            state.sortDir === "asc" ? "arrow_upward" : "arrow_downward";
          th.appendChild(icon);
        }

        // Sort click handler
        th.addEventListener("click", function () {
          var result = nextSortState(state.sortColumn, state.sortDir, col.name);
          state.sortColumn = result.column;
          state.sortDir = result.dir;
          state.page = 0;
          renderColumnHeaders();
          fetchRows();
        });

        columnHeaders.appendChild(th);
      });
    }

    // Actions header
    var thActions = document.createElement("th");
    thActions.textContent = "Actions";
    columnHeaders.appendChild(thActions);
  }

  // === Filter Popup and Tags ===
  function openFilterModal() {
    if (!filterModalOverlay || !filterColSelect) return;
    // Populate column select with current schema columns
    filterColSelect.innerHTML = '<option value="">Column...</option>';
    if (state.schema && state.schema.columns) {
      state.schema.columns.forEach(function (col) {
        var opt = document.createElement("option");
        opt.value = col.name;
        opt.textContent = col.name;
        filterColSelect.appendChild(opt);
      });
    }
    if (filterValInput) filterValInput.value = "";
    filterModalOverlay.style.display = "flex";
  }

  function closeFilterModal() {
    if (filterModalOverlay) filterModalOverlay.style.display = "none";
  }

  function addFilter() {
    if (!filterColSelect || !filterOpSelect || !filterValInput) return;
    var col = filterColSelect.value;
    var op = filterOpSelect.value;
    var val = filterValInput.value.trim();
    if (!col) {
      showToast("Select a column", "error");
      return;
    }
    if (!val) {
      showToast("Enter a value", "error");
      return;
    }

    state.filters.push({ column: col, operator: op, value: val });
    state.page = 0;
    renderFilterTags();
    fetchRows();
    closeFilterModal();
  }

  function removeFilter(index) {
    state.filters.splice(index, 1);
    state.page = 0;
    renderFilterTags();
    fetchRows();
  }

  function renderFilterTags() {
    if (!filterTagsContainer) return;
    filterTagsContainer.innerHTML = "";
    state.filters.forEach(function (f, idx) {
      var tag = document.createElement("span");
      tag.className = "filter-tag";

      var text = document.createElement("span");
      text.className = "filter-tag-text";
      text.textContent = f.column + " " + f.operator + " " + f.value;
      text.title = f.column + " " + f.operator + " " + f.value;
      tag.appendChild(text);

      var removeBtn = document.createElement("button");
      removeBtn.className = "filter-tag-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "Remove filter";
      removeBtn.addEventListener("click", function () {
        removeFilter(idx);
      });
      tag.appendChild(removeBtn);

      filterTagsContainer.appendChild(tag);
    });
  }

  // === Fetch Rows (with filter and sort params) ===
  function fetchRows() {
    var url =
      "/api/tables/" +
      encodeURIComponent(state.activeTable) +
      "/rows?page=" +
      state.page +
      "&limit=" +
      state.limit;

    // Append sort params
    if (state.sortColumn && state.sortDir) {
      url +=
        "&sort=" +
        encodeURIComponent(state.sortColumn) +
        "&dir=" +
        encodeURIComponent(state.sortDir);
    }

    // Append filter params using library syntax: ?column=prefixValue
    for (var i = 0; i < state.filters.length; i++) {
      var f = state.filters[i];
      var encodedValue = encodeFilterValue(f.operator, f.value);
      url += "&" + encodeURIComponent(f.column) + "=" + encodedValue;
    }

    apiGet(url).then(function (result) {
      state.rows = result.data || [];
      state.totalCount = result.count || 0;
      renderRows();
      updatePagination();
    });
  }

  // === Render Rows (with Material Icon action buttons) ===
  function renderRows() {
    dataRows.innerHTML = "";
    if (!state.schema || !state.schema.columns) return;

    state.rows.forEach(function (row) {
      var tr = document.createElement("tr");
      var pkValue = state.pkColumn ? row[state.pkColumn] : null;

      // Checkbox cell
      var tdCheck = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", "Select row");
      checkbox.checked = state.selectedKeys.indexOf(pkValue) !== -1;
      checkbox.addEventListener("change", function () {
        toggleRowSelection(pkValue, checkbox.checked);
        tr.classList.toggle("selected", checkbox.checked);
      });
      tdCheck.appendChild(checkbox);
      tr.appendChild(tdCheck);

      // Data cells
      state.schema.columns.forEach(function (col) {
        var td = document.createElement("td");
        var val = row[col.name];
        td.textContent = formatCellValue(val);
        td.setAttribute("data-column", col.name);
        tr.appendChild(td);
      });

      // Actions cell with Material Icons
      var tdActions = document.createElement("td");
      tdActions.className = "row-actions";

      var btnEdit = document.createElement("button");
      btnEdit.className = "btn-edit";
      btnEdit.setAttribute("aria-label", "Edit row");
      var editIcon = document.createElement("span");
      editIcon.className = "material-icons";
      editIcon.textContent = "edit";
      btnEdit.appendChild(editIcon);
      btnEdit.addEventListener("click", function () {
        startInlineEdit(tr, row);
      });
      tdActions.appendChild(btnEdit);

      var btnRowDelete = document.createElement("button");
      btnRowDelete.className = "btn-row-delete";
      btnRowDelete.setAttribute("aria-label", "Delete row");
      var deleteIcon = document.createElement("span");
      deleteIcon.className = "material-icons";
      deleteIcon.textContent = "delete";
      btnRowDelete.appendChild(deleteIcon);
      btnRowDelete.addEventListener("click", function () {
        deleteSingleRow(pkValue);
      });
      tdActions.appendChild(btnRowDelete);

      tr.appendChild(tdActions);

      if (state.selectedKeys.indexOf(pkValue) !== -1) {
        tr.classList.add("selected");
      }

      dataRows.appendChild(tr);
    });
  }

  // === Delete Single Row ===
  function deleteSingleRow(pkValue) {
    if (!state.pkColumn || pkValue === null || pkValue === undefined) return;
    var confirmed = confirm("Are you sure you want to delete this row?");
    if (!confirmed) return;

    apiDelete(
      "/api/tables/" + encodeURIComponent(state.activeTable) + "/rows",
      {
        keys: [pkValue],
        pkColumn: state.pkColumn,
      },
    ).then(function (result) {
      showToast(result.message || "Row deleted", "success");
      // Remove from selection if selected
      var idx = state.selectedKeys.indexOf(pkValue);
      if (idx !== -1) {
        state.selectedKeys.splice(idx, 1);
      }
      updateSelectionButtons();
      fetchRows();
    });
  }

  // === Row Selection ===
  function toggleRowSelection(pkValue, selected) {
    if (selected) {
      if (state.selectedKeys.indexOf(pkValue) === -1) {
        state.selectedKeys.push(pkValue);
      }
    } else {
      var idx = state.selectedKeys.indexOf(pkValue);
      if (idx !== -1) {
        state.selectedKeys.splice(idx, 1);
      }
    }
    updateSelectionButtons();
  }

  function toggleSelectAll(checked) {
    state.selectedKeys = [];
    if (checked) {
      state.rows.forEach(function (row) {
        if (state.pkColumn && row[state.pkColumn] !== undefined) {
          state.selectedKeys.push(row[state.pkColumn]);
        }
      });
    }
    renderRows();
    updateSelectionButtons();
  }

  function updateSelectionButtons() {
    var hasSelection = state.selectedKeys.length > 0;
    if (btnDelete) btnDelete.disabled = !hasSelection;
    if (btnExport) btnExport.disabled = !hasSelection;
  }

  // === Pagination ===
  function updatePagination() {
    var totalPages =
      state.limit > 0 ? Math.ceil(state.totalCount / state.limit) : 1;
    var currentPage = state.page + 1;
    pageInfo.textContent =
      state.totalCount > 0
        ? "Page " +
          currentPage +
          " of " +
          totalPages +
          " (" +
          state.totalCount +
          " rows)"
        : "No data";
    btnPrev.disabled = state.page <= 0;
    btnNext.disabled = state.limit === 0 || currentPage >= totalPages;
  }

  function goToPrevPage() {
    if (state.page > 0) {
      state.page--;
      fetchRows();
    }
  }

  function goToNextPage() {
    var totalPages =
      state.limit > 0 ? Math.ceil(state.totalCount / state.limit) : 1;
    if (state.page + 1 < totalPages) {
      state.page++;
      fetchRows();
    }
  }

  function onPageSizeChange() {
    state.limit = parseInt(pageSize.value, 10);
    state.page = 0;
    if (state.activeTable) {
      fetchRows();
    }
  }

  // === Add Row Form ===
  function showAddForm() {
    if (!state.schema || !state.activeTable) {
      showToast("Select a table first", "error");
      return;
    }

    // Remove existing form if present
    removeAddForm();

    var panel = document.querySelector(".data-panel-content");
    var form = document.createElement("div");
    form.className = "row-form add-row-form";

    var title = document.createElement("h3");
    title.textContent = "Add Row to " + state.activeTable;
    form.appendChild(title);

    var grid = document.createElement("div");
    grid.className = "form-grid";

    state.schema.columns.forEach(function (col) {
      // Skip auto-increment PK fields
      if (
        col.pk &&
        col.type &&
        col.type.toUpperCase().indexOf("INTEGER") !== -1
      ) {
        return;
      }
      var field = document.createElement("div");
      field.className = "form-field";

      var label = document.createElement("label");
      label.textContent = col.name + (col.nullable ? "" : " *");
      label.setAttribute("for", "add-" + col.name);
      field.appendChild(label);

      var input = document.createElement("input");
      input.type = "text";
      input.id = "add-" + col.name;
      input.name = col.name;
      input.placeholder = col.type || "";
      if (col.default !== null && col.default !== undefined) {
        input.placeholder += " (default: " + col.default + ")";
      }
      field.appendChild(input);
      grid.appendChild(field);
    });

    form.appendChild(grid);

    var actions = document.createElement("div");
    actions.className = "form-actions";

    var btnSave = document.createElement("button");
    btnSave.className = "btn btn-save";
    btnSave.textContent = "Save";
    btnSave.type = "button";
    btnSave.addEventListener("click", function () {
      submitAddForm(form);
    });

    var btnCancel = document.createElement("button");
    btnCancel.className = "btn btn-cancel";
    btnCancel.textContent = "Cancel";
    btnCancel.type = "button";
    btnCancel.addEventListener("click", function () {
      removeAddForm();
    });

    actions.appendChild(btnSave);
    actions.appendChild(btnCancel);
    form.appendChild(actions);

    panel.insertBefore(form, panel.firstChild);
  }

  function removeAddForm() {
    var existing = document.querySelector(".add-row-form");
    if (existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  function submitAddForm(form) {
    var inputs = form.querySelectorAll(".form-grid input");
    var data = {};
    for (var i = 0; i < inputs.length; i++) {
      var name = inputs[i].name;
      var value = inputs[i].value;
      if (value !== "") {
        data[name] = value;
      }
    }

    if (Object.keys(data).length === 0) {
      showToast("Please fill in at least one field", "error");
      return;
    }

    apiPost("/api/tables/" + encodeURIComponent(state.activeTable) + "/rows", {
      data: data,
    }).then(function (result) {
      showToast(result.message || "Row added successfully", "success");
      removeAddForm();
      fetchRows();
    });
  }

  // === Inline Edit ===
  function startInlineEdit(tr, row) {
    if (!state.schema || !state.pkColumn) return;

    // Get data cells (skip checkbox at index 0 and actions at end)
    var cells = tr.querySelectorAll("td[data-column]");
    var originalValues = {};

    for (var i = 0; i < cells.length; i++) {
      var col = cells[i].getAttribute("data-column");
      originalValues[col] = cells[i].textContent;

      // Don't make PK editable
      if (col === state.pkColumn) continue;

      var input = document.createElement("input");
      input.type = "text";
      input.value = cells[i].textContent;
      input.setAttribute("data-column", col);
      cells[i].textContent = "";
      cells[i].appendChild(input);
    }

    // Replace actions
    var actionsCell = tr.querySelector(".row-actions");
    actionsCell.innerHTML = "";

    var btnSave = document.createElement("button");
    btnSave.className = "btn-row-save";
    btnSave.textContent = "Save";
    btnSave.addEventListener("click", function () {
      saveInlineEdit(tr, row, originalValues);
    });

    var btnCancel = document.createElement("button");
    btnCancel.className = "btn-row-cancel";
    btnCancel.textContent = "Cancel";
    btnCancel.addEventListener("click", function () {
      cancelInlineEdit(tr, originalValues);
    });

    actionsCell.appendChild(btnSave);
    actionsCell.appendChild(btnCancel);
  }

  function saveInlineEdit(tr, row, originalValues) {
    var inputs = tr.querySelectorAll("td[data-column] input");
    var data = {};

    // Include PK value
    if (state.pkColumn) {
      data[state.pkColumn] = row[state.pkColumn];
    }

    for (var i = 0; i < inputs.length; i++) {
      var col = inputs[i].getAttribute("data-column");
      data[col] = inputs[i].value;
    }

    // Include unchanged columns from original
    for (var key in originalValues) {
      if (!(key in data)) {
        data[key] = originalValues[key];
      }
    }

    apiPut("/api/tables/" + encodeURIComponent(state.activeTable) + "/rows", {
      data: data,
      uniqueKeys: [state.pkColumn],
    }).then(function (result) {
      showToast(result.message || "Row updated successfully", "success");
      fetchRows();
    });
  }

  function cancelInlineEdit(tr, originalValues) {
    var cells = tr.querySelectorAll("td[data-column]");
    for (var i = 0; i < cells.length; i++) {
      var col = cells[i].getAttribute("data-column");
      cells[i].innerHTML = "";
      cells[i].textContent = originalValues[col] || "";
    }

    // Restore action buttons with Material Icons
    var actionsCell = tr.querySelector(".row-actions");
    actionsCell.innerHTML = "";

    var btnEdit = document.createElement("button");
    btnEdit.className = "btn-edit";
    btnEdit.setAttribute("aria-label", "Edit row");
    var editIcon = document.createElement("span");
    editIcon.className = "material-icons";
    editIcon.textContent = "edit";
    btnEdit.appendChild(editIcon);
    btnEdit.addEventListener("click", function () {
      startInlineEdit(tr, originalValues);
    });
    actionsCell.appendChild(btnEdit);

    var btnRowDelete = document.createElement("button");
    btnRowDelete.className = "btn-row-delete";
    btnRowDelete.setAttribute("aria-label", "Delete row");
    var deleteIcon = document.createElement("span");
    deleteIcon.className = "material-icons";
    deleteIcon.textContent = "delete";
    btnRowDelete.appendChild(deleteIcon);
    actionsCell.appendChild(btnRowDelete);
  }

  // === Delete Selected Rows ===
  function deleteSelectedRows() {
    if (state.selectedKeys.length === 0 || !state.pkColumn) return;

    var count = state.selectedKeys.length;
    var confirmed = confirm(
      "Are you sure you want to delete " + count + " row(s)?",
    );
    if (!confirmed) return;

    apiDelete(
      "/api/tables/" + encodeURIComponent(state.activeTable) + "/rows",
      {
        keys: state.selectedKeys,
        pkColumn: state.pkColumn,
      },
    ).then(function (result) {
      showToast(result.message || count + " row(s) deleted", "success");
      state.selectedKeys = [];
      updateSelectionButtons();
      fetchRows();
    });
  }

  // === Export Selected Rows (CSV with Content-Disposition) ===
  function exportSelectedRows() {
    if (state.selectedKeys.length === 0 || !state.pkColumn) return;

    var url =
      "/api/tables/" + encodeURIComponent(state.activeTable) + "/export";

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: state.selectedKeys,
        pkColumn: state.pkColumn,
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (body) {
            throw new Error(body.message || "Export failed");
          });
        }
        // Parse filename from Content-Disposition header
        var disposition = res.headers.get("Content-Disposition");
        var filename = null;
        if (disposition) {
          var match = disposition.match(/filename="?([^";\s]+)"?/);
          if (match) {
            filename = match[1];
          }
        }
        if (!filename) {
          var timestamp = new Date()
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d+Z$/, "");
          filename = state.activeTable + "_" + timestamp + ".csv";
        }
        return res.blob().then(function (blob) {
          return { blob: blob, filename: filename };
        });
      })
      .then(function (result) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(result.blob);
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        showToast("Export downloaded", "success");
      })
      .catch(function (err) {
        showToast(err.message || "Export failed", "error");
      });
  }

  // === Query Page Logic ===
  function initQueryPage() {
    var queryContent = document.querySelector(".query-content");
    if (!queryContent) return;

    var queryEditor = queryContent.querySelector(".query-editor");
    var btnRun = queryContent.querySelector(".btn-run");
    var btnExportQuery = queryContent.querySelector(".btn-export-query");
    var queryError = queryContent.querySelector(".query-error");
    var queryColumnHeaders = queryContent.querySelector(
      ".query-column-headers",
    );
    var queryDataRows = queryContent.querySelector(".query-data-rows");

    var lastQuery = "";

    function clearResults() {
      if (queryColumnHeaders) queryColumnHeaders.innerHTML = "";
      if (queryDataRows) queryDataRows.innerHTML = "";
      if (queryError) {
        queryError.style.display = "none";
        queryError.textContent = "";
      }
      if (btnExportQuery) btnExportQuery.disabled = true;
    }

    function showQueryError(message) {
      if (queryError) {
        queryError.textContent = message;
        queryError.style.display = "block";
      }
    }

    function renderQueryResults(columns, data) {
      // Render column headers
      if (queryColumnHeaders) {
        queryColumnHeaders.innerHTML = "";
        columns.forEach(function (col) {
          var th = document.createElement("th");
          th.textContent = col;
          queryColumnHeaders.appendChild(th);
        });
      }

      // Render data rows
      if (queryDataRows) {
        queryDataRows.innerHTML = "";
        data.forEach(function (row) {
          var tr = document.createElement("tr");
          columns.forEach(function (col) {
            var td = document.createElement("td");
            var val = row[col];
            td.textContent = formatCellValue(val);
            tr.appendChild(td);
          });
          queryDataRows.appendChild(tr);
        });
      }

      if (btnExportQuery) btnExportQuery.disabled = false;
    }

    // Run button handler
    if (btnRun) {
      btnRun.addEventListener("click", function () {
        var queryText = queryEditor ? queryEditor.value.trim() : "";
        if (!queryText) {
          showToast("Please enter a query", "error");
          return;
        }
        lastQuery = queryText;
        clearResults();

        fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryText }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, body: body };
            });
          })
          .then(function (result) {
            if (!result.ok || result.body.error) {
              showQueryError(result.body.message || "Query execution failed");
              return;
            }
            renderQueryResults(
              result.body.columns || [],
              result.body.data || [],
            );
          })
          .catch(function (err) {
            showQueryError(err.message || "Network error");
          });
      });
    }

    // Export button handler
    if (btnExportQuery) {
      btnExportQuery.addEventListener("click", function () {
        if (!lastQuery) return;

        fetch("/api/query/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: lastQuery }),
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (body) {
                throw new Error(body.message || "Export failed");
              });
            }
            // Parse filename from Content-Disposition header
            var disposition = res.headers.get("Content-Disposition");
            var filename = null;
            if (disposition) {
              var match = disposition.match(/filename="?([^";\s]+)"?/);
              if (match) {
                filename = match[1];
              }
            }
            if (!filename) {
              var timestamp = new Date()
                .toISOString()
                .replace(/[-:]/g, "")
                .replace(/\.\d+Z$/, "");
              filename = "export_" + timestamp + ".csv";
            }
            return res.blob().then(function (blob) {
              return { blob: blob, filename: filename };
            });
          })
          .then(function (result) {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(result.blob);
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            showToast("Export downloaded", "success");
          })
          .catch(function (err) {
            showToast(err.message || "Export failed", "error");
          });
      });
    }
  }

  // === Dashboard Page Logic ===
  function initDashboardPage() {
    var dashboardContent = document.querySelector(".dashboard-content");
    if (!dashboardContent) return;

    var tableBody = dashboardContent.querySelector(".dashboard-table-body");
    if (!tableBody) return;

    apiGet("/api/dashboard").then(function (data) {
      var tables = data.tables || [];
      tableBody.innerHTML = "";

      if (tables.length === 0) {
        var tr = document.createElement("tr");
        var td = document.createElement("td");
        td.colSpan = 5;
        td.textContent = "No tables found.";
        td.style.textAlign = "center";
        td.style.padding = "24px";
        tr.appendChild(td);
        tableBody.appendChild(tr);
        return;
      }

      tables.forEach(function (table) {
        var tr = document.createElement("tr");
        tr.className = "dashboard-row";
        tr.setAttribute("data-table", table.name);

        var tdName = document.createElement("td");
        tdName.className = "dashboard-table-name";
        tdName.textContent = table.name;
        tr.appendChild(tdName);

        var tdCols = document.createElement("td");
        tdCols.textContent = table.columnCount;
        tr.appendChild(tdCols);

        var tdIndexes = document.createElement("td");
        tdIndexes.textContent =
          table.indexCount !== undefined ? table.indexCount : "—";
        tr.appendChild(tdIndexes);

        var tdRows = document.createElement("td");
        tdRows.textContent = table.rowCount.toLocaleString();
        tr.appendChild(tdRows);

        var tdSize = document.createElement("td");
        tdSize.textContent =
          table.sizeMB !== undefined ? table.sizeMB.toFixed(3) : "—";
        tr.appendChild(tdSize);

        tr.addEventListener("click", function () {
          window.location.href =
            "/tables?table=" + encodeURIComponent(table.name);
        });

        tableBody.appendChild(tr);
      });
    });
  }

  // === Sidebar Nav Link Active State and Click Handling ===
  function initNavLinks() {
    var navLinks = document.querySelectorAll(".nav-link");
    var currentPath = window.location.pathname;

    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];
      var page = link.getAttribute("data-page");

      // Set active state based on current URL
      if (
        (page === "dashboard" && currentPath === "/dashboard") ||
        (page === "tables" && currentPath === "/tables") ||
        (page === "query" && currentPath === "/query") ||
        (page === "history" && currentPath === "/history")
      ) {
        link.classList.add("active");
      }

      // Click handling
      (function (navLink) {
        navLink.addEventListener("click", function (e) {
          e.preventDefault();
          var href = navLink.getAttribute("href");
          if (href) {
            window.location.href = href;
          }
        });
      })(link);
    }
  }

  // === History Page Logic ===
  function initHistoryPage() {
    var historyContent = document.querySelector(".history-content");
    if (!historyContent) return;

    var tableBody = historyContent.querySelector(".history-table-body");
    if (!tableBody) return;

    apiGet("/api/history/queries").then(function (data) {
      var queries = data.queries || [];
      tableBody.innerHTML = "";

      if (queries.length === 0) {
        var tr = document.createElement("tr");
        var td = document.createElement("td");
        td.colSpan = 4;
        td.textContent = "No query history found.";
        td.style.textAlign = "center";
        td.style.padding = "24px";
        tr.appendChild(td);
        tableBody.appendChild(tr);
        return;
      }

      queries.forEach(function (q, idx) {
        var tr = document.createElement("tr");

        var tdNum = document.createElement("td");
        tdNum.textContent = idx + 1;
        tr.appendChild(tdNum);

        var tdQuery = document.createElement("td");
        tdQuery.className = "history-query-text";
        tdQuery.textContent = q.query_text || q.queryText || "";
        tdQuery.title = q.query_text || q.queryText || "";
        tr.appendChild(tdQuery);

        var tdRows = document.createElement("td");
        tdRows.textContent =
          q.row_count !== undefined
            ? q.row_count
            : q.rowCount !== undefined
              ? q.rowCount
              : "—";
        tr.appendChild(tdRows);

        var tdTime = document.createElement("td");
        tdTime.textContent = formatCellValue(
          q.executed_at || q.executedAt || "—",
        );
        tr.appendChild(tdTime);

        tableBody.appendChild(tr);
      });
    });
  }

  // === Event Bindings ===
  function bindEvents() {
    if (tableSearchInput) {
      tableSearchInput.addEventListener("input", onTableSearch);
    }
    if (btnAdd) btnAdd.addEventListener("click", showAddForm);
    if (btnDelete) btnDelete.addEventListener("click", deleteSelectedRows);
    if (btnExport) btnExport.addEventListener("click", exportSelectedRows);
    if (btnFilter) btnFilter.addEventListener("click", openFilterModal);
    if (btnFilterAdd) btnFilterAdd.addEventListener("click", addFilter);
    if (filterModalClose)
      filterModalClose.addEventListener("click", closeFilterModal);
    if (filterModalOverlay) {
      filterModalOverlay.addEventListener("click", function (e) {
        if (e.target === filterModalOverlay) closeFilterModal();
      });
    }
    if (filterValInput) {
      filterValInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") addFilter();
      });
    }
    if (btnPrev) btnPrev.addEventListener("click", goToPrevPage);
    if (btnNext) btnNext.addEventListener("click", goToNextPage);
    if (pageSize) pageSize.addEventListener("change", onPageSizeChange);
  }

  // === Initialize ===
  function init() {
    // Initialize nav links on all pages
    initNavLinks();

    // Setup sidebar tables accordion toggle
    setupAccordion();

    // Always fetch and display tables in the sidebar (visible on all pages)
    fetchTables();

    // Setup table search on all pages
    if (tableSearchInput) {
      tableSearchInput.addEventListener("input", onTableSearch);
    }

    // Detect which page we're on and initialize accordingly
    var queryContent = document.querySelector(".query-content");
    var dashboardContent = document.querySelector(".dashboard-content");
    var historyContent = document.querySelector(".history-content");

    if (queryContent) {
      // Query page
      initQueryPage();
      return;
    }

    if (dashboardContent) {
      // Dashboard page
      initDashboardPage();
      return;
    }

    if (historyContent) {
      // History page
      initHistoryPage();
      return;
    }

    // Default: Table browser page
    bindEvents();

    // Check if a table is specified in the URL
    var urlParams = new URLSearchParams(window.location.search);
    var tableParam = urlParams.get("table");
    if (tableParam) {
      // Wait for tables to load, then select the specified table
      apiGet("/api/tables").then(function (data) {
        state.tables = data.tables || [];
        renderTableList(state.tables);
        if (state.tables.indexOf(tableParam) !== -1) {
          selectTable(tableParam);
        }
      });
    }
  }

  // Start the app when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
