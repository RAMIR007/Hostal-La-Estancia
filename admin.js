import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client.js";

const CONTENT_TABLE = "site_content";
const PHOTO_BUCKET = "hostal-media";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const textGroups = {
  contact: [
    { key: "contact_title", label: "Título de contacto", wide: true },
    { key: "contact_intro", label: "Introducción", wide: true },
    { key: "whatsapp", label: "WhatsApp", type: "tel", hint: "Incluye el código de país. Usa entre 7 y 15 dígitos." },
    { key: "email", label: "Correo electrónico", type: "email" },
    { key: "address", label: "Dirección", wide: true },
  ],
  texts: [
    { key: "hero_title", label: "Título principal", wide: true },
    { key: "hero_intro", label: "Introducción principal", wide: true },
    { key: "hero_note", label: "Nota principal", wide: true },
    { key: "intro_title", label: "Título de bienvenida", wide: true },
    { key: "intro_paragraph_1", label: "Bienvenida · párrafo 1", wide: true },
    { key: "intro_paragraph_2", label: "Bienvenida · párrafo 2", wide: true },
    { key: "experience_title", label: "Título de experiencias", wide: true },
    { key: "experience_intro", label: "Introducción de experiencias", wide: true },
    { key: "guide_title", label: "Título · guía local", wide: true },
    { key: "guide_description", label: "Descripción · guía local", wide: true },
    { key: "local_title", label: "Título · recomendaciones", wide: true },
    { key: "local_description", label: "Descripción · recomendaciones", wide: true },
    { key: "stay_title", label: "Título · alojamiento", wide: true },
    { key: "stay_description", label: "Descripción · alojamiento", wide: true },
  ],
};

const photoItems = [
  { key: "hero_image_url", label: "Foto principal", alt: "Foto principal del sitio" },
  { key: "room_image_url", label: "Habitación", alt: "Foto de una habitación" },
  { key: "experience_image_url", label: "Experiencia", alt: "Foto de una experiencia local" },
];

const elements = {
  status: document.querySelector("#global-status"),
  loginView: document.querySelector("#login-view"),
  invitePasswordView: document.querySelector("#invite-password-view"),
  dashboard: document.querySelector("#dashboard"),
  loginForm: document.querySelector("#login-form"),
  loginStatus: document.querySelector("#login-status"),
  invitePasswordForm: document.querySelector("#invite-password-form"),
  invitePasswordStatus: document.querySelector("#invite-password-status"),
  accountLabel: document.querySelector("#account-label"),
};

let supabase;
let currentUser;
let inviteUser;
let inviteSetupPending = false;
let content = {};
const photoState = new Map();
const previewObjectUrls = new Map();
const tabDefinitions = [
  { button: "#tab-contact", panel: "#panel-contact" },
  { button: "#tab-photos", panel: "#panel-photos" },
  { button: "#tab-texts", panel: "#panel-texts" },
  { button: "#tab-users", panel: "#panel-users" },
];

function setMessage(element, message, kind = "") {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", kind === "error");
  element.classList.toggle("is-success", kind === "success");
}

function showGlobal(message, kind = "") {
  setMessage(elements.status, message, kind);
  if (elements.status) elements.status.hidden = !message;
}

function errorText(error, fallback) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : fallback;
}

function hasInviteCallback() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("type") === "invite" || fragment.get("type") === "invite";
}

function cleanAuthCallbackUrl() {
  window.history.replaceState(window.history.state, document.title, window.location.pathname);
}

function setBusy(form, busy, busyText = "Guardando…") {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
  button.disabled = busy;
}

function createField(definition) {
  const wrapper = document.createElement("div");
  wrapper.className = `field${definition.wide ? " field--wide" : ""}`;
  const label = document.createElement("label");
  const id = `field-${definition.key}`;
  label.htmlFor = id;
  label.textContent = definition.label;

  const isLong = definition.wide || definition.key.includes("paragraph") || definition.key.includes("description") || definition.key.includes("intro");
  const control = document.createElement(isLong ? "textarea" : "input");
  control.id = id;
  control.name = definition.key;
  control.dataset.contentField = definition.key;
  if (control instanceof HTMLInputElement) {
    control.type = definition.type || "text";
    control.autocomplete = definition.type === "email" ? "email" : "off";
    if (definition.type === "tel") control.inputMode = "tel";
    if (definition.type === "email") control.maxLength = 254;
  }
  const describedBy = [];
  if (definition.hint) {
    const hint = document.createElement("span");
    hint.id = `${id}-hint`;
    hint.className = "field-hint";
    hint.textContent = definition.hint;
    wrapper.append(label, control, hint);
    describedBy.push(hint.id);
  } else {
    wrapper.append(label, control);
  }
  if (describedBy.length) control.setAttribute("aria-describedby", describedBy.join(" "));
  return wrapper;
}

function renderFields() {
  for (const [group, definitions] of Object.entries(textGroups)) {
    const container = document.querySelector(`#${group}-fields`);
    if (!container) continue;
    for (const definition of definitions) container.append(createField(definition));
  }

  const container = document.querySelector("#photo-fields");
  for (const photo of photoItems) {
    const card = document.createElement("article");
    card.className = "photo-card";
    const title = document.createElement("h3");
    title.textContent = photo.label;

    const preview = document.createElement("div");
    preview.className = "photo-preview";
    preview.setAttribute("aria-live", "polite");
    preview.textContent = "Aún no hay una foto";

    const label = document.createElement("label");
    const inputId = `file-${photo.key}`;
    label.htmlFor = inputId;
    label.textContent = "Elegir imagen";
    const input = document.createElement("input");
    input.id = inputId;
    input.className = "file-input";
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    input.setAttribute("aria-describedby", `${inputId}-hint`);
    const hint = document.createElement("span");
    hint.id = `${inputId}-hint`;
    hint.className = "field-hint";
    hint.textContent = "JPG, PNG o WebP · máximo 5 MB";
    const actions = document.createElement("div");
    actions.className = "photo-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-photo";
    remove.textContent = "Quitar foto";
    remove.setAttribute("aria-pressed", "false");

    input.addEventListener("change", () => handleFileSelection(photo, input, preview, remove));
    remove.addEventListener("click", () => {
      const state = photoState.get(photo.key) || { file: null, remove: false };
      state.file = null;
      state.remove = !state.remove;
      photoState.set(photo.key, state);
      input.value = "";
      remove.setAttribute("aria-pressed", String(state.remove));
      remove.textContent = state.remove ? "Se quitará al guardar" : "Quitar foto";
      renderPhotoPreview(preview, photo, null, state.remove);
      setMessage(document.querySelector('[data-status-for="photos"]'), "");
    });

    actions.append(remove);
    card.append(title, preview, label, input, hint, actions);
    container.append(card);
    photoState.set(photo.key, { file: null, remove: false });
  }
}

function renderPhotoPreview(preview, photo, src, removed = false) {
  const previousObjectUrl = previewObjectUrls.get(photo.key);
  if (previousObjectUrl && previousObjectUrl !== src) {
    URL.revokeObjectURL(previousObjectUrl);
    previewObjectUrls.delete(photo.key);
  }
  preview.replaceChildren();
  if (!src || removed) {
    preview.textContent = removed ? "La foto se quitará al guardar" : "Aún no hay una foto";
    return;
  }
  const image = document.createElement("img");
  image.src = src;
  image.alt = photo.alt;
  preview.append(image);
}

function handleFileSelection(photo, input, preview, remove) {
  const status = document.querySelector('[data-status-for="photos"]');
  const file = input.files?.[0];
  if (!file) return;
  const discardSelection = () => {
    input.value = "";
    photoState.set(photo.key, { file: null, remove: false });
    remove.setAttribute("aria-pressed", "false");
    remove.textContent = "Quitar foto";
    renderPhotoPreview(preview, photo, content[photo.key] || "");
  };
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size > MAX_FILE_SIZE) {
    discardSelection();
    setMessage(status, "La imagen supera el límite de 5 MB.", "error");
    return;
  }
  if (!IMAGE_TYPES.has(file.type) || !["jpg", "jpeg", "png", "webp"].includes(extension)) {
    discardSelection();
    setMessage(status, "Formato no permitido. Elige JPG, PNG o WebP.", "error");
    return;
  }
  const state = { file, remove: false };
  photoState.set(photo.key, state);
  const objectUrl = URL.createObjectURL(file);
  previewObjectUrls.set(photo.key, objectUrl);
  remove.setAttribute("aria-pressed", "false");
  remove.textContent = "Quitar foto";
  renderPhotoPreview(preview, photo, objectUrl);
  setMessage(status, "");
}

function populateContent(data) {
  content = data || {};
  document.querySelectorAll("[data-content-field]").forEach((control) => {
    const key = control.dataset.contentField;
    control.value = typeof content[key] === "string" ? content[key] : "";
  });
  photoItems.forEach((photo) => {
    const preview = document.querySelector(`#file-${photo.key}`)?.closest(".photo-card")?.querySelector(".photo-preview");
    if (preview) renderPhotoPreview(preview, photo, content[photo.key] || "");
    const state = { file: null, remove: false };
    photoState.set(photo.key, state);
    const remove = document.querySelector(`#file-${photo.key}`)?.closest(".photo-card")?.querySelector(".remove-photo");
    if (remove) {
      remove.setAttribute("aria-pressed", "false");
      remove.textContent = "Quitar foto";
    }
  });
}

function formValues(form) {
  const values = {};
  form.querySelectorAll("[data-content-field]").forEach((control) => {
    values[control.dataset.contentField] = control.value.trim();
  });
  if (Object.prototype.hasOwnProperty.call(values, "whatsapp") && values.whatsapp) {
    const digits = values.whatsapp.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      throw new Error("El número de WhatsApp debe tener entre 7 y 15 dígitos.");
    }
  }
  if (Object.prototype.hasOwnProperty.call(values, "email") && values.email && !EMAIL_PATTERN.test(values.email)) {
    throw new Error("Escribe un correo electrónico válido.");
  }
  return values;
}

async function updateContent(patch, form, status) {
  setBusy(form, true);
  setMessage(status, "Guardando cambios…");
  try {
    const { error } = await supabase.from(CONTENT_TABLE).update(patch).eq("id", true).select("id").single();
    if (error) throw error;
    Object.assign(content, patch);
    populateContent(content);
    setMessage(status, "Cambios guardados y publicados.", "success");
  } catch (error) {
    setMessage(status, `No se pudieron guardar los cambios. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
  } finally {
    setBusy(form, false);
  }
}

async function savePhotos(form) {
  const status = document.querySelector('[data-status-for="photos"]');
  setBusy(form, true);
  setMessage(status, "Subiendo y guardando fotos…");
  const uploadedPaths = [];
  const patch = {};
  try {
    for (const photo of photoItems) {
      const state = photoState.get(photo.key);
      if (state?.remove) {
        patch[photo.key] = null;
      } else if (state?.file) {
        const extension = IMAGE_TYPES.get(state.file.type);
        const uniqueId = globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${currentUser.id}/${uniqueId}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, state.file, { contentType: state.file.type, cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        if (!data?.publicUrl) throw new Error("No se pudo obtener la URL pública de una imagen.");
        patch[photo.key] = data.publicUrl;
      }
    }

    if (!Object.keys(patch).length) {
      setMessage(status, "Elige una imagen o marca una foto para quitarla.");
      return;
    }

    const { error: updateError } = await supabase.from(CONTENT_TABLE).update(patch).eq("id", true).select("id").single();
    if (updateError) throw updateError;
    Object.assign(content, patch);
    populateContent(content);
    setMessage(status, "Fotos guardadas y publicadas.", "success");
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: cleanupError } = await supabase.storage.from(PHOTO_BUCKET).remove(uploadedPaths);
      if (cleanupError) {
          setMessage(status, `No se guardaron las fotos y falló la limpieza de la subida temporal. ${errorText(error, "Error al actualizar.")} ${errorText(cleanupError, "")}`, "error");
      } else {
        setMessage(status, `No se pudieron guardar las fotos. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
      }
    } else {
      setMessage(status, `No se pudieron guardar las fotos. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
    }
  } finally {
    setBusy(form, false);
  }
}

function setActiveTab(button) {
  tabDefinitions.forEach(({ button: buttonSelector, panel: panelSelector }) => {
    const tab = document.querySelector(buttonSelector);
    const panel = document.querySelector(panelSelector);
    const active = tab === button;
    if (tab) {
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    if (panel) panel.hidden = !active;
  });
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const visibleTabs = tabs.filter((item) => !item.hidden);
      let nextIndex = visibleTabs.indexOf(tab);
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = visibleTabs.length - 1;
      else nextIndex = (nextIndex + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
      visibleTabs[nextIndex].focus();
      setActiveTab(visibleTabs[nextIndex]);
    });
  });
}

async function loadSiteContent() {
  const { data, error } = await supabase.from(CONTENT_TABLE).select("*").eq("id", true).single();
  if (error) throw error;
  populateContent(data);
}

function showLoggedOut() {
  currentUser = null;
  inviteUser = null;
  inviteSetupPending = false;
  elements.dashboard.hidden = true;
  elements.invitePasswordView.hidden = true;
  elements.loginView.hidden = false;
  elements.accountLabel.textContent = "";
  showGlobal("");
}

async function authenticateUser(user) {
  if (!user?.id) {
    showLoggedOut();
    return;
  }
  elements.loginView.hidden = true;
  elements.dashboard.hidden = true;
  showGlobal("Verificando permisos…");
  try {
    const { data: profile, error } = await supabase.from("user_profiles")
      .select("user_id,email,role,created_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile || !["admin", "owner"].includes(profile.role)) {
      await supabase.auth.signOut();
      throw new Error("Esta cuenta no tiene un perfil autorizado para administrar el sitio.");
    }
    currentUser = user;
    elements.accountLabel.textContent = `${profile.email || user.email || ""} · ${profile.role === "admin" ? "Administrador" : "Responsable"}`;
    document.querySelector("#tab-users").hidden = profile.role !== "admin";
    const { data: initialContent, error: contentError } = await supabase.from(CONTENT_TABLE)
      .select("*").eq("id", true).single();
    if (contentError) throw contentError;
    populateContent(initialContent);
    elements.dashboard.hidden = false;
    showGlobal("");
    if (profile.role === "admin") await loadUsers();
  } catch (error) {
    currentUser = null;
    elements.dashboard.hidden = true;
    elements.loginView.hidden = false;
    showGlobal(errorText(error, "No se pudo verificar el acceso. Inténtalo otra vez."), "error");
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date);
}

async function loadUsers() {
  const status = document.querySelector("#users-status");
  const list = document.querySelector("#users-list");
  list.replaceChildren();
  setMessage(status, "Cargando perfiles…");
  const refresh = document.querySelector("#refresh-users");
  refresh.disabled = true;
  try {
    const { data, error } = await supabase.from("user_profiles")
      .select("user_id,email,role,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    if (!data?.length) {
      setMessage(status, "Todavía no hay perfiles para mostrar.");
      return;
    }
    for (const profile of data) {
      const row = document.createElement("tr");
      const email = document.createElement("td");
      email.textContent = profile.email || "Correo no disponible";
      const roleCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "role-badge";
      badge.textContent = profile.role === "admin"
        ? "Administrador"
        : profile.role === "owner"
          ? "Responsable"
          : "Pendiente";
      roleCell.append(badge);
      const created = document.createElement("td");
      created.textContent = formatDate(profile.created_at);
      row.append(email, roleCell, created);
      list.append(row);
    }
    setMessage(status, `${data.length} perfil${data.length === 1 ? "" : "es"}.`, "success");
  } catch (error) {
    setMessage(status, `No se pudo cargar la lista. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
  } finally {
    refresh.disabled = false;
  }
}

function setupForms() {
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!EMAIL_PATTERN.test(email)) {
      setMessage(elements.loginStatus, "Escribe un correo electrónico válido.", "error");
      return;
    }
    setBusy(form, true, "Ingresando…");
    setMessage(elements.loginStatus, "Comprobando acceso…");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await authenticateUser(data.user);
      if (currentUser) setMessage(elements.loginStatus, "");
    } catch (error) {
      setMessage(elements.loginStatus, `No se pudo iniciar sesión. ${errorText(error, "Revisa tus datos e inténtalo otra vez.")}`, "error");
    } finally {
      setBusy(form, false);
    }
  });

  elements.invitePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmPassword.value;
    if (password.length < 12) {
      setMessage(elements.invitePasswordStatus, "La contraseña debe tener al menos 12 caracteres.", "error");
      form.elements.password.focus();
      return;
    }
    if (password !== confirmation) {
      setMessage(elements.invitePasswordStatus, "Las contraseñas no coinciden. Vuelve a comprobarlas.", "error");
      form.elements.confirmPassword.focus();
      return;
    }
    if (!inviteUser) {
      inviteSetupPending = false;
      elements.invitePasswordView.hidden = true;
      elements.loginView.hidden = false;
      showGlobal("La invitación no es válida o ha caducado. Solicita una nueva invitación e inicia sesión si ya tienes acceso.", "error");
      return;
    }

    setBusy(form, true, "Guardando contraseña…");
    setMessage(elements.invitePasswordStatus, "Actualizando tu contraseña…");
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      cleanAuthCallbackUrl();
      const authenticatedUser = data?.user || inviteUser;
      inviteSetupPending = false;
      inviteUser = null;
      form.reset();
      elements.invitePasswordView.hidden = true;
      showGlobal("Contraseña guardada. Verificando tu acceso…");
      await authenticateUser(authenticatedUser);
    } catch (error) {
      setMessage(elements.invitePasswordStatus, `No se pudo guardar la contraseña. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
    } finally {
      setBusy(form, false);
    }
  });

  document.querySelector("#contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector('[data-status-for="contact"]');
    try {
      await updateContent(formValues(form), form, status);
    } catch (error) {
      setMessage(status, errorText(error, "Revisa los datos e inténtalo de nuevo."), "error");
    }
  });
  document.querySelector("#texts-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector('[data-status-for="texts"]');
    try {
      await updateContent(formValues(form), form, status);
    } catch (error) {
      setMessage(status, errorText(error, "Revisa los datos e inténtalo de nuevo."), "error");
    }
  });
  document.querySelector("#photos-form").addEventListener("submit", (event) => {
    event.preventDefault();
    savePhotos(event.currentTarget);
  });

  document.querySelector("#logout-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showGlobal("Cerrando sesión…");
    const { error } = await supabase.auth.signOut();
    button.disabled = false;
    if (error) {
      showGlobal(`No se pudo cerrar sesión. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
      return;
    }
    showLoggedOut();
  });

  document.querySelector("#invite-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const status = document.querySelector("#invite-status");
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      setMessage(status, "Escribe un correo electrónico válido.", "error");
      return;
    }
    setBusy(form, true, "Enviando invitación…");
    setMessage(status, "Enviando invitación…");
    try {
      const { error } = await supabase.functions.invoke("invite-owner", { body: { email } });
      if (error) throw error;
      form.reset();
      setMessage(status, "Invitación enviada. La persona recibirá un correo para acceder como responsable.", "success");
      await loadUsers();
    } catch (error) {
      setMessage(status, `No se pudo enviar la invitación. ${errorText(error, "Inténtalo de nuevo.")}`, "error");
    } finally {
      setBusy(form, false);
    }
  });
  document.querySelector("#refresh-users").addEventListener("click", loadUsers);
}

async function init() {
  renderFields();
  setupTabs();
  setupForms();
  if (!isSupabaseConfigured()) {
    elements.loginView.hidden = false;
    elements.loginForm.querySelector('button[type="submit"]').disabled = true;
    showGlobal("La administración requiere que Supabase esté configurado. Solicita al equipo del sitio que complete su configuración.", "error");
    return;
  }
  try {
    supabase = await getSupabaseClient();
    const inviteCallback = hasInviteCallback();
    inviteSetupPending = inviteCallback;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (inviteCallback) {
      if (data.session?.user) {
        inviteUser = data.session.user;
        elements.loginView.hidden = true;
        elements.dashboard.hidden = true;
        elements.invitePasswordView.hidden = false;
        showGlobal("");
      } else {
        inviteSetupPending = false;
        cleanAuthCallbackUrl();
        elements.dashboard.hidden = true;
        elements.invitePasswordView.hidden = true;
        elements.loginView.hidden = false;
        showGlobal("La invitación no es válida o ha caducado. Solicita una nueva invitación e inicia sesión si ya tienes acceso.", "error");
      }
    } else {
      await authenticateUser(data.session?.user);
    }
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        showLoggedOut();
      } else if (!inviteSetupPending && event === "SIGNED_IN" && session?.user?.id !== currentUser?.id) {
        window.setTimeout(() => authenticateUser(session.user), 0);
      }
    });
  } catch (error) {
    inviteSetupPending = false;
    if (hasInviteCallback()) cleanAuthCallbackUrl();
    elements.loginView.hidden = false;
    elements.invitePasswordView.hidden = true;
    showGlobal(
      hasInviteCallback()
        ? "La invitación no es válida o ha caducado. Solicita una nueva invitación e inicia sesión si ya tienes acceso."
        : errorText(error, "No se pudo conectar con Supabase. Inténtalo otra vez."),
      "error",
    );
  }
}

init();
