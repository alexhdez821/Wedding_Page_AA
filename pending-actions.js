import { RSVP_BACKEND, isBackendConfigured } from "./rsvp-config.js";

const FALLBACK_LIST_KEY = "alejandro-alejandra-wedding-actions";
const LOCAL_STORAGE_PREFIX = "aa-wedding-actions:";

const params = new URLSearchParams(window.location.search);
const listKey = params.get("list")?.trim() || FALLBACK_LIST_KEY;
const localStorageKey = `${LOCAL_STORAGE_PREFIX}${listKey}`;

const backendConfigured = isBackendConfigured();

const state = {
  tasks: [],
  filter: "open",
  isShared: backendConfigured,
  backendError: null
};

const elements = {
  form: document.querySelector("#task-form"),
  formTitle: document.querySelector("#form-title"),
  taskId: document.querySelector("#task-id"),
  title: document.querySelector("#task-title"),
  assignee: document.querySelector("#task-assignee"),
  dueDate: document.querySelector("#task-due-date"),
  notes: document.querySelector("#task-notes"),
  submitButton: document.querySelector("#submit-button"),
  cancelEdit: document.querySelector("#cancel-edit"),
  refreshList: document.querySelector("#refresh-list"),
  taskList: document.querySelector("#task-list"),
  emptyState: document.querySelector("#empty-state"),
  counts: document.querySelector("#task-counts"),
  storageStatus: document.querySelector("#storage-status"),
  statusDot: document.querySelector("#status-dot"),
  filters: document.querySelectorAll(".filter-button")
};

const supabaseHeaders = () => ({
  apikey: RSVP_BACKEND.supabaseAnonKey,
  Authorization: `Bearer ${RSVP_BACKEND.supabaseAnonKey}`,
  "Content-Type": "application/json"
});

function rpcUrl(functionName) {
  return `${RSVP_BACKEND.supabaseUrl}/rest/v1/rpc/${functionName}`;
}

function setStorageStatus(message, mode) {
  elements.storageStatus.textContent = message;
  elements.statusDot.classList.toggle("synced", mode === "synced");
  elements.statusDot.classList.toggle("local", mode === "local");
  elements.statusDot.classList.toggle("error", mode === "error");
}

function normalizeTask(task) {
  return {
    id: task.id || crypto.randomUUID(),
    list_key: task.list_key || listKey,
    title: task.title || "Untitled task",
    notes: task.notes || "",
    assignee: task.assignee || "Both",
    due_date: task.due_date || "",
    status: task.status || "open",
    created_at: task.created_at || new Date().toISOString(),
    updated_at: task.updated_at || new Date().toISOString()
  };
}

async function callSupabaseFunction(functionName, payload) {
  const response = await fetch(rpcUrl(functionName), {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function loadLocalTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(localStorageKey) || "[]");
    state.tasks = saved.map(normalizeTask);
  } catch {
    state.tasks = [];
  }
}

function saveLocalTasks() {
  localStorage.setItem(localStorageKey, JSON.stringify(state.tasks));
}

async function loadTasks() {
  if (!backendConfigured) {
    loadLocalTasks();
    setStorageStatus("Local-only mode: Supabase URL/key are missing from rsvp-config.js.", "local");
    render();
    return;
  }

  try {
    const tasks = await callSupabaseFunction("get_wedding_actions", { p_list_key: listKey });
    state.tasks = tasks.map(normalizeTask);
    state.backendError = null;
    state.isShared = true;
    setStorageStatus("Shared list synced with Supabase.", "synced");
  } catch (error) {
    console.error(error);
    state.backendError = error;
    state.isShared = false;
    state.tasks = [];
    setStorageStatus("Supabase is configured but the page cannot reach it. Check the browser console and SQL setup.", "error");
  }

  render();
}

async function persistTask(task) {
  if (backendConfigured && !state.isShared) {
    throw new Error("Supabase is configured but unavailable. The task was not saved locally to avoid hiding a sync problem.");
  }

  if (!state.isShared) {
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      state.tasks[index] = task;
    } else {
      state.tasks.unshift(task);
    }
    saveLocalTasks();
    render();
    return;
  }

  const saved = await callSupabaseFunction("upsert_wedding_action", {
    p_id: task.id,
    p_list_key: task.list_key,
    p_title: task.title,
    p_notes: task.notes,
    p_assignee: task.assignee,
    p_due_date: task.due_date || null,
    p_status: task.status
  });

  if (!saved?.[0]) {
    throw new Error("Supabase did not return the saved task. Check the list key and RPC function setup.");
  }

  const savedTask = normalizeTask(saved[0]);
  const index = state.tasks.findIndex((item) => item.id === savedTask.id);
  if (index >= 0) {
    state.tasks[index] = savedTask;
  } else {
    state.tasks.unshift(savedTask);
  }

  render();
}

async function deleteTask(id) {
  if (backendConfigured && !state.isShared) {
    throw new Error("Supabase is configured but unavailable. The task was not deleted locally to avoid hiding a sync problem.");
  }

  if (!state.isShared) {
    state.tasks = state.tasks.filter((task) => task.id !== id);
    saveLocalTasks();
    render();
    return;
  }

  await callSupabaseFunction("delete_wedding_action", {
    p_id: id,
    p_list_key: listKey
  });
  state.tasks = state.tasks.filter((task) => task.id !== id);
  render();
}

function visibleTasks() {
  return state.tasks.filter((task) => {
    if (state.filter === "all") return true;
    if (state.filter === "done") return task.status === "done";
    return task.status !== "done";
  });
}

function formatDate(dateString) {
  if (!dateString) return "No due date";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  const tasks = visibleTasks();
  const openCount = state.tasks.filter((task) => task.status !== "done").length;
  const doneCount = state.tasks.length - openCount;

  elements.counts.textContent = `${openCount} open • ${doneCount} done • ${state.tasks.length} total`;
  elements.emptyState.hidden = tasks.length > 0;
  elements.taskList.innerHTML = tasks.map((task) => `
    <li class="task-card ${task.status === "done" ? "done" : ""}" data-id="${escapeHtml(task.id)}">
      <div class="task-top">
        <div>
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          ${task.notes ? `<p class="task-notes">${escapeHtml(task.notes)}</p>` : ""}
        </div>
        <div class="task-actions">
          <button type="button" data-action="toggle">${task.status === "done" ? "Reopen" : "Done"}</button>
          <button type="button" data-action="edit">Edit</button>
          <button class="delete" type="button" data-action="delete">Delete</button>
        </div>
      </div>
      <div class="meta">
        <span class="tag">${escapeHtml(task.assignee)}</span>
        <span class="tag">${formatDate(task.due_date)}</span>
      </div>
    </li>
  `).join("");
}

function resetForm() {
  elements.form.reset();
  elements.taskId.value = "";
  elements.assignee.value = "Both";
  elements.formTitle.textContent = "Add a task";
  elements.submitButton.textContent = "Add task";
  elements.cancelEdit.hidden = true;
}

function editTask(task) {
  elements.taskId.value = task.id;
  elements.title.value = task.title;
  elements.assignee.value = task.assignee;
  elements.dueDate.value = task.due_date || "";
  elements.notes.value = task.notes || "";
  elements.formTitle.textContent = "Edit task";
  elements.submitButton.textContent = "Save changes";
  elements.cancelEdit.hidden = false;
  elements.title.focus();
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.submitButton.disabled = true;

  const existing = state.tasks.find((task) => task.id === elements.taskId.value);
  const task = normalizeTask({
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    list_key: listKey,
    title: elements.title.value.trim(),
    assignee: elements.assignee.value,
    due_date: elements.dueDate.value,
    notes: elements.notes.value.trim(),
    status: existing?.status || "open",
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  try {
    await persistTask(task);
    resetForm();
  } catch (error) {
    console.error(error);
    alert("Sorry, this task could not be saved. Please refresh and try again.");
  } finally {
    elements.submitButton.disabled = false;
  }
});

elements.cancelEdit.addEventListener("click", resetForm);

elements.refreshList.addEventListener("click", async () => {
  elements.refreshList.disabled = true;
  await loadTasks();
  elements.refreshList.disabled = false;
});

elements.taskList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest(".task-card");
  const task = state.tasks.find((item) => item.id === card.dataset.id);
  if (!task) return;

  const action = button.dataset.action;

  if (action === "edit") {
    editTask(task);
    return;
  }

  button.disabled = true;

  try {
    if (action === "toggle") {
      await persistTask(normalizeTask({
        ...task,
        status: task.status === "done" ? "open" : "done",
        updated_at: new Date().toISOString()
      }));
    }

    if (action === "delete") {
      const confirmed = confirm(`Delete "${task.title}"?`);
      if (confirmed) {
        await deleteTask(task.id);
      }
    }
  } catch (error) {
    console.error(error);
    alert("Sorry, that update did not save. Please refresh and try again.");
  } finally {
    button.disabled = false;
  }
});

elements.filters.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    elements.filters.forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

loadTasks();
window.setInterval(() => {
  if (state.isShared) {
    loadTasks();
  }
}, 30000);
