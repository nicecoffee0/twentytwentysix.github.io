const PAGE = {
  login: "index.html",
  home: "home.html",
  category: "category.html",
  newEntry: "new-entry.html",
  article: "article.html",
  edit: "edit.html",
  structureEdit: "structure-edit.html",
};



const ARCHIVE_STATE_TABLE = "archive_state";
let siteStateCache = null;

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqStrings(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return doc.body.textContent || "";
}

function hasRenderableContent(html) {
  const text = stripHtml(html).trim();
  return Boolean(text || /<(img|iframe|video|audio)\b/i.test(String(html || "")));
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-GB");
}

function formatDateTime(dateString) {
  return new Date(dateString).toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatIndex(n) {
  return String(n).padStart(2, "0");
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function buildUrl(path, params = {}) {
  const url = new URL(path, window.location.href);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

function categoryUrl(categoryId, subcategoryId = "") {
  return buildUrl(PAGE.category, { category: categoryId, subcategory: subcategoryId });
}

function makeSafeId(prefix = "item") {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function makeIdFromLabel(label, prefix = "item") {
  const slug = slugify(label);
  return slug || makeSafeId(prefix);
}

function normalizeSubcategory(subcategory) {
  const label = String(subcategory?.label || "").trim();
  const id = String(subcategory?.id || "").trim() || makeIdFromLabel(label, "sub");
  const aliases = uniqStrings([...(subcategory?.aliases || []), label]);
  const positionValue = Number(subcategory?.position);
  const position = Number.isFinite(positionValue) ? positionValue : null;

  return {
    id,
    label,
    aliases,
    position,
  };
}

function normalizeCategory(category) {
  const label = String(category?.label || "").trim();
  const id = String(category?.id || "").trim() || makeIdFromLabel(label, "cat");
  const aliases = uniqStrings([...(category?.aliases || []), label]);

  const subcategories = Array.isArray(category?.subcategories)
    ? category.subcategories
        .map(normalizeSubcategory)
        .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999))
    : [];

  return {
    id,
    label,
    className: category?.className || "custom",
    aliases,
    subcategories,
    isCustom: !!category?.isCustom,
  };
}

function normalizeSiteState(rawState) {
  return {
    categories: Array.isArray(rawState?.categories)
      ? rawState.categories.map(normalizeCategory)
      : [],
  };
}


async function loadSiteState() {
  if (siteStateCache) return siteStateCache;

  const { data, error } = await supabaseClient
    .from(ARCHIVE_STATE_TABLE)
    .select("state")
    .eq("id", "main")
    .maybeSingle();

  if (error) {
    console.error("LOAD SITE STATE ERROR:", error);
    siteStateCache = { categories: [] };
    return siteStateCache;
  }

  siteStateCache = normalizeSiteState(data?.state);
  return siteStateCache;
}

async function saveSiteState(state) {
  const normalized = normalizeSiteState(state);

  const { error } = await supabaseClient.from(ARCHIVE_STATE_TABLE).upsert(
    { id: "main", state: normalized },
    { onConflict: "id" }
  );

  if (error) throw error;

  siteStateCache = normalized;
}

function findCategoryByRaw(categories, raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  return (
    categories.find((category) => {
      const variants = uniqStrings([category.id, category.label, ...(category.aliases || [])]);
      return variants.includes(value);
    }) || null
  );
}

function findSubcategoryByRaw(category, raw) {
  if (!category) return null;

  const value = String(raw || "").trim();
  if (!value) return null;

  return (
    (category.subcategories || []).find((sub) => {
      const variants = uniqStrings([sub.id, sub.label, ...(sub.aliases || [])]);
      return variants.includes(value);
    }) || null
  );
}

function getCategoryVariants(category) {
  if (!category) return [];
  return uniqStrings([category.id, category.label, ...(category.aliases || [])]);
}

function getSubcategoryVariants(subcategory) {
  if (!subcategory) return [];
  return uniqStrings([subcategory.id, subcategory.label, ...(subcategory.aliases || [])]);
}

function getCategoryIndexText(categories, categoryId) {
  const index = categories.findIndex((category) => category.id === categoryId);
  return index >= 0 ? formatIndex(index + 1) : "";
}

function getSubcategoryIndexText(category, subcategory) {
  if (!category || !subcategory) return "";
  const index = (category.subcategories || []).findIndex((sub) => sub.id === subcategory.id);
  return index >= 0 ? formatIndex(index + 1) : "";
}

function getExcerpt(content, maxLength = 120) {
  const clean = stripHtml(content).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}…` : clean;
}

function renderStoredHtml(content) {
  const raw = String(content || "").trim();
  if (!raw) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return escapeHtml(raw)
    .split("\n")
    .map((line) => (line ? `<p>${line}</p>` : "<p><br></p>"))
    .join("");
}

function buildEntryMarkup(entry, href, variant = "list") {
  if (variant === "preview") {
    return `
      <a href="${href}" class="entry-preview-item">
        <div class="entry-preview-date">${formatDate(entry.created_at)}</div>
        <div class="entry-preview-body">
          <strong>${escapeHtml(entry.title)}</strong>
          <span class="${/[가-힣]/.test(getExcerpt(entry.content || "", 130)) ? "korean-excerpt" : "english-excerpt"}">
            ${escapeHtml(
              /[가-힣]/.test(entry.content || "")
                ? getExcerpt(entry.content || "", 90)  // korean
                : getExcerpt(entry.content || "", 170)  // english
            )}
          </span>
        </div>
      </a>
    `;
  }

  return `
    <a href="${href}" class="entry">
      <div class="entry-date">${formatDate(entry.created_at)}</div>
      <div class="entry-body">
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="${/[가-힣]/.test(getExcerpt(entry.content || "", 130)) ? "korean-excerpt" : "english-excerpt"}">
          ${escapeHtml(
            /[가-힣]/.test(entry.content || "")
              ? getExcerpt(entry.content || "", 90)  // korean
              : getExcerpt(entry.content || "", 170)  // english
          )}
        </span>
      </div>
    </a>
  `;
}

function ensureUploadInput(id = "image-upload") {
  let input = document.getElementById(id);
  if (input) return input;

  input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.id = id;
  document.body.appendChild(input);
  return input;
}

async function uploadImageFile(file) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabaseClient.storage
    .from("entry-images")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) throw uploadError;

  const { data } = supabaseClient.storage
    .from("entry-images")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

function setupRichEditor(
  editorId,
  uploadInputId = "image-upload",
  imageButtonId = "image-btn"
) {
  const editor = document.getElementById(editorId);
  const toolbar = document.querySelector(".editor-toolbar");
  const uploadInput = ensureUploadInput(uploadInputId);

  if (!editor || !toolbar) return;

  toolbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) {
      event.preventDefault();
    }
  });

  toolbar.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const cmd = button.dataset.cmd;

    /*
     * NORMAL FORMATTING
     */

    if (
      cmd === "bold" ||
      cmd === "italic" ||
      cmd === "underline" ||
      cmd === "insertUnorderedList" ||
      cmd === "insertOrderedList" ||
      cmd === "indent" ||
      cmd === "outdent"
    ) {
      document.execCommand(cmd, false, null);
      editor.focus();
      return;
    }

    /*
     * HIGHLIGHT
     */

    if (button.classList.contains("hl")) {
      const color = button.dataset.color;
      document.execCommand("hiliteColor", false, color);
      editor.focus();
      return;
    }

    /*
     * CLEAR FORMAT
     */

    if (button.id === "clear-format-btn") {
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
      editor.focus();
      return;
    }

    /*
     * IMAGE
     */

    if (button.id === imageButtonId) {
      uploadInput.click();
      editor.focus();
      return;
    }

    /*
     * EMBED
     */

    if (button.id === "embed-btn") {
      const url = prompt(
        "Paste a YouTube, Google Sheets, Google Docs, Google Slides, or other embed URL:"
      );

      if (!url) return;

      const embedHtml = createEmbedHtml(url.trim());

      if (!embedHtml) {
        alert(
          "Sorry, this URL isn't supported yet.\n\n" +
          "Currently supported:\n" +
          "• YouTube\n" +
          "• Google Sheets\n" +
          "• Google Docs\n" +
          "• Google Slides"
        );
        return;
      }

      editor.focus();

      document.execCommand(
        "insertHTML",
        false,
        embedHtml + "<p><br></p>"
      );

      return;
    }

     /*
     * GREY BOX
     */

    if (button.id === "box-btn") {
      editor.focus();

      const boxHtml = `
        <div class="editor-note-box">
          <div><br></div>
        </div>
        <p><br></p>
      `;

      document.execCommand("insertHTML", false, boxHtml);

      return;
    }
  });

  /*
   * PASTE AS CLEAN TEXT
   */

  editor.addEventListener("copy", (event) => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = document.createElement("div");

    container.appendChild(range.cloneContents());

    const html = container.innerHTML;
    const text = selection.toString();

    event.clipboardData.setData(
      "text/html",
      `<div data-yena-content="true">${html}</div>`
    );

    event.clipboardData.setData("text/plain", text);

    event.preventDefault();
  });


editor.addEventListener("paste", (event) => {
  event.preventDefault();

  const html = event.clipboardData.getData("text/html");
  const plainText = event.clipboardData.getData("text/plain");

  /*
   * OUR CONTENT
   * Preserve formatting.
   */
  if (html && html.includes('data-yena-content="true"')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const content = doc.querySelector("[data-yena-content]");

    if (content) {
      document.execCommand(
        "insertHTML",
        false,
        content.innerHTML
      );

      return;
    }
  }

  /*
   * EXTERNAL CONTENT
   * Strip formatting.
   */
  const cleanText = plainText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ");

  const lines = cleanText.split("\n");

  const cleanHtml = lines
    .map((line) => {
      if (line.trim() === "") {
        return "<br>";
      }

      return escapeHtml(line);
    })
    .join("<br>");

  document.execCommand(
    "insertHTML",
    false,
    cleanHtml
  );
});

  /*
   * TAB INDENTATION
   */

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();

      if (event.shiftKey) {
        document.execCommand("outdent", false, null);
      } else {
        document.execCommand("indent", false, null);
      }
    }
  });

  /*
   * IMAGE UPLOAD
   */

  uploadInput.onchange = async () => {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;

    try {
      const url = await uploadImageFile(file);

      editor.focus();

      document.execCommand(
        "insertImage",
        false,
        url
      );
    } catch (error) {
      alert(`IMAGE UPLOAD ERROR:\n\n${error.message}`);
    } finally {
      uploadInput.value = "";
    }
  };
}


/*
 * CREATE EMBED HTML
 */

function createEmbedHtml(url) {
  /*
   * YOUTUBE
   */

  let match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/
  );

  if (match) {
    const videoId = match[1];

    return `
      <div class="embed-container">
        <iframe
          src="https://www.youtube.com/embed/${videoId}"
          title="YouTube video"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen>
        </iframe>
      </div>
    `;
  }

  /*
   * GOOGLE SHEETS
   */

  if (
    url.includes("docs.google.com/spreadsheets/")
  ) {
    return `
      <div class="embed-container embed-sheet">
        <iframe
          src="${escapeAttribute(url)}"
          frameborder="0">
        </iframe>
      </div>
    `;
  }

  /*
   * GOOGLE DOCS
   */

  if (
    url.includes("docs.google.com/document/")
  ) {
    return `
      <div class="embed-container embed-document">
        <iframe
          src="${escapeAttribute(url)}"
          frameborder="0">
        </iframe>
      </div>
    `;
  }

  /*
   * GOOGLE SLIDES
   */

  if (
    url.includes("docs.google.com/presentation/")
  ) {
    return `
      <div class="embed-container embed-slides">
        <iframe
          src="${escapeAttribute(url)}"
          frameborder="0"
          allowfullscreen>
        </iframe>
      </div>
    `;
  }

  return null;
}


/*
 * SAFELY ESCAPE AN ATTRIBUTE
 */

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function requireSessionOrRedirect() {
  const session = await getSession();
  if (!session) {
    window.location.href = PAGE.login;
    return null;
  }
  return session;
}

async function initLoginPage() {
  const session = await getSession();
  if (session) {
    window.location.href = PAGE.home;
    return;
  }

  const loginForm = document.getElementById("login-form");
  if (!loginForm) return;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const message = document.getElementById("login-message");

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      message.textContent = error.message;
      return;
    }

    window.location.href = PAGE.home;
  });
}

async function loadHomePage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const logoutButton = document.getElementById("logout");
  const addCategoryButton = document.getElementById("add-category-button");
  const editCategoryButton = document.getElementById("edit-category-button");
  const dashboard = document.getElementById("dashboard");

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = PAGE.login;
    });
  }

async function renderHome() {
  const state = await loadSiteState();
  const categories = state.categories || [];

  if (!dashboard) return;

  dashboard.innerHTML = categories
    .map((category, index) => {
      const subchips = (category.subcategories || [])
        .map((sub) => `<span class="subchip">${escapeHtml(sub.label)}</span>`)
        .join("");

      return `
        <a
          href="${categoryUrl(category.id)}"
          class="category"
          style="
            --category-color: var(--category-${index + 1}, var(--paper));
            background: var(--category-color);
          "
        >
          <span class="number">${String(index + 1).padStart(2, "0")}</span>
          <div class="category-content">
            <h2>${escapeHtml(category.label)}</h2>
            <div class="subcategories">${subchips}</div>
          </div>
        </a>
      `;
    })
    .join("");
}

  await renderHome();

  if (addCategoryButton) {
    addCategoryButton.onclick = async () => {
      const state = await loadSiteState();
      const name = prompt("New category name")?.trim();
      if (!name) return;

      const id = slugify(name);
      if (state.categories.some((c) => c.id === id || c.label.toLowerCase() === name.toLowerCase())) {
        alert("That category already exists.");
        return;
      }

      state.categories.push({
        id,
        label: name,
        className: "custom",
        aliases: [name],
        subcategories: [],
        isCustom: true,
      });

      await saveSiteState(state);
      await renderHome();
    };
  }

}

function resequenceSubcategories(category) {
  category.subcategories.forEach((sub, index) => {
    sub.position = index + 1;
  });
}

async function moveSubcategory(categoryId, subcategoryId, direction) {
  const state = deepClone(await loadSiteState());
  const category = state.categories.find((cat) => cat.id === categoryId);
  if (!category) return;

  category.subcategories.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));

  const index = category.subcategories.findIndex((sub) => sub.id === subcategoryId);
  if (index < 0) return;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= category.subcategories.length) return;

  const temp = category.subcategories[index];
  category.subcategories[index] = category.subcategories[targetIndex];
  category.subcategories[targetIndex] = temp;

  resequenceSubcategories(category);
  await saveSiteState(state);
  window.location.reload();
}

async function loadCategoryPage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const state = await loadSiteState();
  const categories = state.categories || [];

  const titleEl = document.getElementById("category-title");
  const pathEl = document.getElementById("category-path");
  const descriptionEl = document.getElementById("category-description");
  const subcategoryList = document.getElementById("subcategory-list");
  const entriesContainer = document.getElementById("entries");
  const newEntryLink = document.getElementById("new-entry-link");
  const editStructureButton = document.getElementById("edit-structure-button");
  const pageNumber = document.getElementById("page-number");

  if (
    !titleEl ||
    !pathEl ||
    !subcategoryList ||
    !entriesContainer ||
    !newEntryLink ||
    !editStructureButton
  ) {
    return;
  }

  const categoryRaw = getParam("category");
  const subcategoryRaw = getParam("subcategory") || "";
  const reorderMode = getParam("reorder") === "1";

  if (!categoryRaw) {
    window.location.href = PAGE.home;
    return;
  }

  const decodedCategoryRaw = decodeURIComponent(categoryRaw);
  const decodedSubcategoryRaw = decodeURIComponent(subcategoryRaw);

  let category = findCategoryByRaw(categories, decodedCategoryRaw);

  if (!category) {
    category = {
      id: decodedCategoryRaw,
      label: decodedCategoryRaw,
      className: "custom",
      aliases: [decodedCategoryRaw],
      subcategories: [],
      isCustom: true,
    };
  }

  const actionBar = newEntryLink.parentElement;
  const articleActions = editStructureButton.parentElement; 
  let deleteCategoryButton = document.getElementById(
    "delete-category-button"
  );

  /*
   * ============================================================
   * EDITING / REORDER MODE
   * ============================================================
   */

  if (reorderMode) {
    editStructureButton.textContent = "SAVE";
    editStructureButton.href = "#";

    editStructureButton.onclick = async (event) => {
      event.preventDefault();

      const input = document.getElementById("edit-category-title");
      const newLabel = input ? input.value.trim() : "";

      if (!newLabel) {
        alert("Please enter a category name.");
        return;
      }

      const freshState = deepClone(await loadSiteState());

      const target = freshState.categories.find(
        (cat) => cat.id === category.id
      );

      if (!target) return;

      const oldLabel = target.label;

      target.aliases = uniqStrings([
        ...(target.aliases || []),
        oldLabel,
        newLabel,
      ]);

      target.label = newLabel;

      await saveSiteState(freshState);

      window.location.href = categoryUrl(target.id);
    };

    if (!deleteCategoryButton) {
      deleteCategoryButton = document.createElement("button");
      deleteCategoryButton.id = "delete-category-button";
      deleteCategoryButton.type = "button";
      deleteCategoryButton.className = "action-button danger";
      deleteCategoryButton.textContent = "DELETE";

      articleActions.insertBefore(
        deleteCategoryButton,
        editStructureButton
      );
    } else {
      deleteCategoryButton.style.display = "inline-flex";
    }

    deleteCategoryButton.onclick = async () => {
      await deleteCategoryAndArticles(category.id);
    };
  } else {
    /*
     * ============================================================
     * NORMAL MODE
     * ============================================================
     */

    editStructureButton.onclick = null;

    if (subcategoryRaw) {
      editStructureButton.textContent = "EDIT SUBCATEGORY";

      editStructureButton.href = buildUrl(PAGE.structureEdit, {
        type: "subcategory",
        category: category.id,
        subcategory: decodedSubcategoryRaw,
      });
    } else {
      editStructureButton.textContent = "EDIT CATEGORY";

      editStructureButton.href = buildUrl(PAGE.category, {
        category: category.id,
        reorder: "1",
      });
    }

    if (deleteCategoryButton) {
      deleteCategoryButton.remove();
    }

    const backLink = document.getElementById("back-link");

    if (backLink) {
      if (subcategoryRaw) {
        backLink.href =
          `category.html?category=${encodeURIComponent(category.id)}`;
      } else {
        backLink.href = "home.html";
      }
    }
  }

  const categoryIndex = getCategoryIndexText(categories, category.id);

  /*
   * ============================================================
   * SUBCATEGORY PAGE
   * ============================================================
   */

  if (subcategoryRaw) {
    const subcategory = findSubcategoryByRaw(
      category,
      decodedSubcategoryRaw
    );

    titleEl.textContent = subcategory
      ? subcategory.label
      : decodedSubcategoryRaw;

    pathEl.innerHTML = `
      <a href="${categoryUrl(category.id)}">
        ${escapeHtml(category.label)}
      </a> /
      <a href="${categoryUrl(
        category.id,
        subcategory ? subcategory.id : decodedSubcategoryRaw
      )}">
        ${escapeHtml(
          subcategory ? subcategory.label : decodedSubcategoryRaw
        )}
      </a>
    `;

    if (pageNumber) {
      pageNumber.textContent = subcategory
        ? getSubcategoryIndexText(category, subcategory)
        : "";
    }

    newEntryLink.textContent = "+ NEW ENTRY";

    newEntryLink.href = buildUrl(PAGE.newEntry, {
      category: category.id,
      subcategory: subcategory
        ? subcategory.id
        : decodedSubcategoryRaw,
    });

    newEntryLink.onclick = null;

    subcategoryList.innerHTML = "";

    const categoryVariants = getCategoryVariants(category);

    const subcategoryVariants = subcategory
      ? getSubcategoryVariants(subcategory)
      : uniqStrings([decodedSubcategoryRaw]);

    const { data, error } = await supabaseClient
      .from("articles")
      .select("id, title, created_at, content")
      .in("category", categoryVariants)
      .in("subcategory", subcategoryVariants)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("LOAD CATEGORY ENTRIES ERROR:", error);

      entriesContainer.innerHTML =
        "<p class='empty-state'>Could not load entries.</p>";

      return;
    }

    if (!data || data.length === 0) {
      entriesContainer.innerHTML =
        "<p class='empty-state'>No entries yet.</p>";

      return;
    }

    entriesContainer.innerHTML = data
      .map((entry) =>
        buildEntryMarkup(
          entry,
          `${PAGE.article}?id=${entry.id}`,
          "list"
        )
      )
      .join("");

    return;
  }

  /*
   * ============================================================
   * CATEGORY PAGE
   * ============================================================
   */

  if (reorderMode) {
    titleEl.innerHTML = `
      <textarea
        id="edit-category-title"
        class="title-input"
      >${escapeHtml(category.label)}</textarea>
    `;
  } else {
    titleEl.textContent = category.label;
  }

  pathEl.textContent = "";

  if (pageNumber) {
    pageNumber.textContent = categoryIndex;
  }

  newEntryLink.textContent = "+ ADD SUBCATEGORY";
  newEntryLink.href = "#";

  newEntryLink.onclick = async (event) => {
    event.preventDefault();

    const rawName = prompt("New subcategory name");
    const name = rawName ? rawName.trim() : "";

    if (!name) return;

    const freshState = deepClone(await loadSiteState());

    const currentCategory = freshState.categories.find(
      (cat) => cat.id === category.id
    );

    if (!currentCategory) return;

    if (
      currentCategory.subcategories.some(
        (sub) => sub.label.toLowerCase() === name.toLowerCase()
      )
    ) {
      alert("That subcategory already exists.");
      return;
    }

    const baseId = slugify(name) || "subcategory";

    let id = baseId;
    let counter = 2;

    const existingIds = new Set(
      currentCategory.subcategories.map((sub) => sub.id)
    );

    while (existingIds.has(id)) {
      id = `${baseId}-${counter}`;
      counter += 1;
    }

    const nextPosition =
      currentCategory.subcategories.length + 1;

    currentCategory.subcategories.push({
      id,
      label: name,
      aliases: [name],
      position: nextPosition,
    });

    await saveSiteState(freshState);

    window.location.reload();
  };

  const subs = (category.subcategories || []).sort(
    (a, b) =>
      (a.position ?? 9999) -
      (b.position ?? 9999)
  );

  if (subs.length === 0) {
    subcategoryList.innerHTML =
      "<p class='empty-state'>No subcategories yet.</p>";

    entriesContainer.innerHTML = "";

    return;
  }

  /*
   * ============================================================
   * NORMAL CATEGORY VIEW
   * ============================================================
   */

  if (!reorderMode) {
    subcategoryList.innerHTML = subs
      .map(
        (sub, index) => `
          <a
            class="subsection"
            href="${categoryUrl(category.id, sub.id)}"
          >
            <div>
              <span class="subsection-number">
                ${formatIndex(index + 1)}
              </span>

              <h2>${escapeHtml(sub.label)}</h2>
            </div>

            <span class="arrow">↗︎</span>
          </a>
        `
      )
      .join("");

    entriesContainer.innerHTML = "";

    return;
  }

  /*
   * ============================================================
   * CATEGORY EDITING / SUBCATEGORY REORDERING
   * ============================================================
   */

  subcategoryList.classList.add("reorder-mode");

  subcategoryList.innerHTML = subs
    .map(
      (sub, index) => `
        <div class="subsection-row">

          <a
            class="subsection"
            href="${categoryUrl(category.id, sub.id)}"
          >
            <div>
              <span class="subsection-number">
                ${formatIndex(index + 1)}
              </span>

              <h2>${escapeHtml(sub.label)}</h2>
            </div>

            <span class="arrow">↗︎</span>
          </a>

          <div class="reorder-buttons">

            <button
              type="button"
              class="reorder-btn"
              data-action="up"
              data-category="${category.id}"
              data-sub="${sub.id}"
            >
              ↑
            </button>

            <button
              type="button"
              class="reorder-btn"
              data-action="down"
              data-category="${category.id}"
              data-sub="${sub.id}"
            >
              ↓
            </button>

          </div>

        </div>
      `
    )
    .join("");

  subcategoryList
    .querySelectorAll(".reorder-btn")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const categoryId = btn.dataset.category;
        const subId = btn.dataset.sub;
        const action = btn.dataset.action;

        await moveSubcategory(
          categoryId,
          subId,
          action
        );
      });
    });

  entriesContainer.innerHTML = "";
}

async function loadNewEntryPage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const titleInput = document.getElementById("title");
  const contentEditor = document.getElementById("content");
  const categoryLabel = document.getElementById("article-category");
  const backLink = document.getElementById("back-link");
  const editorInfo = document.getElementById("editor-info");
  const saveButton = document.getElementById("save-entry");

  if (!titleInput) {
    alert("MISSING: #title");
    return;
  }

  if (!contentEditor) {
    alert("MISSING: #content");
    return;
  }

  if (!categoryLabel) {
    alert("MISSING: #article-category");
    return;
  }

  if (!backLink) {
    alert("MISSING: #back-link");
    return;
  }

  if (!saveButton) {
    alert("MISSING: #save-entry");
    return;
  }

  /*
   * GET CATEGORY AND SUBCATEGORY FIRST
   */

  const categoryRaw = getParam("category") || "";
  const subcategoryRaw = getParam("subcategory") || "";

  if (!categoryRaw) {
    alert("NEW ENTRY ERROR: No category was provided.");
    return;
  }

  /*
   * ATTACH SAVE BUTTON IMMEDIATELY
   * This means nothing else can prevent SAVE from getting its handler.
   */

  saveButton.onclick = async () => {
    try {
      const title = titleInput.value.trim();

      const contentHtml = contentEditor.innerHTML
        .replace(/&nbsp;/g, " ")
        .replace(/\u00A0/g, " ")
        .trim();

      if (!title) {
        alert("Please enter a title.");
        return;
      }

      if (!hasRenderableContent(contentHtml)) {
        alert("Please enter some content.");
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = "SAVING...";

      const categories = (await loadSiteState()).categories || [];

      const category = findCategoryByRaw(categories, categoryRaw);

      if (!category) {
        throw new Error(
          `Category not found.\n\nReceived category: ${categoryRaw}`
        );
      }

      const subcategory = subcategoryRaw
        ? findSubcategoryByRaw(category, subcategoryRaw)
        : null;

      const categoryId = category.id;

      const subcategoryId = subcategory
        ? subcategory.id
        : subcategoryRaw;

      if (subcategoryRaw && !subcategoryId) {
        throw new Error(
          `Subcategory ID is missing.\n\nReceived subcategory: ${subcategoryRaw}`
        );
      }

      console.log("SAVING ENTRY:");
      console.log("Category:", categoryId);
      console.log("Subcategory:", subcategoryId);
      console.log("Title:", title);

      const { data, error } = await supabaseClient
        .from("articles")
        .insert([
          {
            title: title,
            content: contentHtml,
            category: categoryId,
            subcategory: subcategoryId,
          },
        ])
        .select();

      if (error) {
        throw new Error(
          `SUPABASE SAVE ERROR:\n\n${error.message}`
        );
      }

      console.log("ENTRY SAVED:", data);

      window.location.href = categoryUrl(
        categoryId,
        subcategoryId
      );

    } catch (error) {
      console.error("NEW ENTRY SAVE ERROR:", error);

      alert(
        "NEW ENTRY SAVE ERROR:\n\n" +
        (error?.message || String(error))
      );

      saveButton.disabled = false;
      saveButton.textContent = "SAVE";
    }
  };

  /*
   * LOAD CATEGORY INFORMATION FOR DISPLAY
   */

  try {
    const categories = (await loadSiteState()).categories || [];

    const category = findCategoryByRaw(categories, categoryRaw);

    if (!category) {
      throw new Error(
        `Category not found: ${categoryRaw}`
      );
    }

    const subcategory = subcategoryRaw
      ? findSubcategoryByRaw(category, subcategoryRaw)
      : null;

    const categoryText = category.label;

    const subcategoryText = subcategory
      ? subcategory.label
      : subcategoryRaw;

    categoryLabel.textContent = subcategoryText
      ? `${categoryText} / ${subcategoryText}`
      : categoryText;

    if (editorInfo) {
      editorInfo.textContent = categoryLabel.textContent;
    }

    backLink.href = categoryUrl(
      category.id,
      subcategory ? subcategory.id : subcategoryRaw
    );

  } catch (error) {
    console.error("NEW ENTRY LOAD ERROR:", error);

    alert(
      "NEW ENTRY LOAD ERROR:\n\n" +
      (error?.message || String(error))
    );
  }

  /*
   * EDITOR SETUP
   */

  autoGrowTitle(titleInput);

  setupRichEditor(
    "content",
    "image-upload",
    "image-btn"
  );
}

async function loadArticlePage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const state = await loadSiteState();
  const categories = state.categories || [];

  const articleTitle = document.getElementById("article-title");
  const articleMeta = document.getElementById("article-meta");
  const articleContent = document.getElementById("article-content");
  const articleCategory = document.getElementById("article-category");
  const backLink = document.getElementById("back-link");
  const editButton = document.getElementById("edit-button");
  const entryPreview = document.getElementById("entry-preview");

  if (!articleTitle || !articleMeta || !articleContent || !articleCategory) return;

  const id = getParam("id");
  if (!id) {
    articleTitle.textContent = "Article not found";
    articleMeta.textContent = "";
    articleContent.innerHTML = "<p>No article id was provided.</p>";
    return;
  }

  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("LOAD ARTICLE ERROR:", error);
    articleTitle.textContent = "Article not found";
    articleMeta.textContent = "";
    articleContent.innerHTML = "<p>This article could not be loaded.</p>";
    return;
  }

  const category = findCategoryByRaw(categories, data.category);
  const subcategory = category ? findSubcategoryByRaw(category, data.subcategory) : null;

  const categoryId = category ? category.id : data.category;
  const subcategoryId = subcategory ? subcategory.id : data.subcategory;
  const categoryText = category ? category.label : data.category;
  const subcategoryText = subcategory ? subcategory.label : data.subcategory;

  if (subcategoryText) {
    articleCategory.innerHTML = `
      <a href="${categoryUrl(categoryId)}">${escapeHtml(categoryText)}</a> /
      <a href="${categoryUrl(categoryId, subcategoryId)}">${escapeHtml(subcategoryText)}</a>
    `;
  } else {
    articleCategory.innerHTML = `<a href="${categoryUrl(categoryId)}">${escapeHtml(categoryText)}</a>`;
  }

  articleTitle.textContent = data.title;
  articleMeta.textContent = formatDateTime(data.created_at);
  articleContent.innerHTML = renderStoredHtml(data.content);

  if (backLink) {
    backLink.href = categoryUrl(categoryId, subcategoryId);
  }

  if (editButton) {
    editButton.href = `${PAGE.edit}?id=${id}`;
  }

  if (entryPreview) {
    const categoryVariants = category ? getCategoryVariants(category) : uniqStrings([data.category]);
    const subcategoryVariants = subcategory ? getSubcategoryVariants(subcategory) : uniqStrings([data.subcategory]);

    let query = supabaseClient
      .from("articles")
      .select("id, title, created_at, content, category, subcategory")
      .in("category", categoryVariants);

    if (subcategoryText) {
      query = query.in("subcategory", subcategoryVariants);
    }

    const { data: siblingEntries, error: siblingsError } = await query.order("created_at", { ascending: false });

    if (siblingsError) {
      console.error("LOAD PREVIEW ERROR:", siblingsError);
      entryPreview.innerHTML = "<p class='empty-state'>Could not load other entries.</p>";
      return;
    }

    const others = (siblingEntries || [])
      .filter((entry) => entry.id !== id)
      .slice(0, 5);

    if (!others.length) {
      entryPreview.innerHTML = "";
      return;
    }

    entryPreview.innerHTML = others
      .map((entry) => buildEntryMarkup(entry, `${PAGE.article}?id=${entry.id}`, "preview"))
      .join("");
  }


}

async function loadEditPage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const titleInput = document.getElementById("edit-title");
    autoGrowTitle(titleInput);
  const contentEditor = document.getElementById("edit-content");
  const categoryLabel = document.getElementById("article-category");
  const meta = document.getElementById("edit-meta");
  const backLink = document.getElementById("back-link");
  const saveButton = document.getElementById("save-edit-button");
  const deleteButton = document.getElementById("delete-edit-button");

  if (!titleInput || !contentEditor || !categoryLabel || !meta || !saveButton || !deleteButton) return;

  setupRichEditor("edit-content", "image-upload", "image-btn");

  const state = await loadSiteState();
  const categories = state.categories || [];

  const id = getParam("id");
  if (!id) {
    meta.textContent = "No article id provided.";
    return;
  }

  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("LOAD EDIT ARTICLE ERROR:", error);
    meta.textContent = "Could not load article.";
    return;
  }

  const category = findCategoryByRaw(categories, data.category);
  const subcategory = category ? findSubcategoryByRaw(category, data.subcategory) : null;

  titleInput.value = data.title || "";
  contentEditor.innerHTML = data.content || "";
  categoryLabel.textContent = subcategory
    ? `${category ? category.label : data.category} / ${subcategory.label}`
    : (category ? category.label : data.category);
  meta.textContent = formatDateTime(data.created_at);

  if (backLink) {
    backLink.href = `${PAGE.article}?id=${id}`;
  }

  saveButton.onclick = async () => {
    const newTitle = titleInput.value.trim();
    const newContent = contentEditor.innerHTML
      .replace(/&nbsp;/g, " ")
      .replace(/\u00A0/g, " ")
      .trim();

    if (!newTitle || !hasRenderableContent(newContent)) {
      alert("Please enter a title and some content.");
      return;
    }

    const { error: updateError } = await supabaseClient
      .from("articles")
      .update({
        title: newTitle,
        content: newContent,
      })
      .eq("id", id);

    if (updateError) {
      alert("UPDATE ERROR:\n\n" + updateError.message);
      return;
    }

    window.location.href = `${PAGE.article}?id=${id}`;
  };

  deleteButton.onclick = async () => {
    const confirmed = confirm("Delete this article?");
    if (!confirmed) return;

    const { error: deleteError } = await supabaseClient
      .from("articles")
      .delete()
      .eq("id", id);

    if (deleteError) {
      alert("DELETE ERROR:\n\n" + deleteError.message);
      return;
    }

    const categoryId = category ? category.id : data.category;
    const subcategoryId = subcategory ? subcategory.id : data.subcategory;
    window.location.href = categoryUrl(categoryId, subcategoryId);
  };


}

async function loadStructureEditPage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const kindEl = document.getElementById("structure-kind");
  const parentEl = document.getElementById("structure-parent");
  const idEl = document.getElementById("structure-id");
  const labelInput = document.getElementById("structure-label");
  const backLink = document.getElementById("back-link");
  const saveButton = document.getElementById("save-structure-button");
  const deleteButton = document.getElementById("delete-structure-button");

  if (!kindEl || !parentEl || !idEl || !labelInput || !backLink || !saveButton || !deleteButton) return;

  const type = getParam("type");
  const categoryRaw = getParam("category") || "";
  const subcategoryRaw = getParam("subcategory") || "";

  if (!type || !categoryRaw) {
    window.location.href = PAGE.home;
    return;
  }

  const state = await loadSiteState();
  const categories = state.categories || [];
  const category = findCategoryByRaw(categories, categoryRaw);

  if (!category) {
    parentEl.textContent = "Not found";
    idEl.textContent = "";
    return;
  }

  if (type === "category") {
    kindEl.textContent = "EDIT CATEGORY";
    parentEl.textContent = "CATEGORY";
    labelInput.value = category.label;
    idEl.textContent = `ID: ${category.id}`;
    backLink.href = categoryUrl(category.id);

    saveButton.onclick = async () => {
      const newLabel = labelInput.value.trim();
      if (!newLabel) {
        alert("Please enter a name.");
        return;
      }

      const freshState = deepClone(await loadSiteState());
      const target = freshState.categories.find((cat) => cat.id === category.id);
      if (!target) return;

      const oldLabel = target.label;
      target.aliases = uniqStrings([...(target.aliases || []), oldLabel, newLabel]);
      target.label = newLabel;

      await saveSiteState(freshState);
      window.location.href = categoryUrl(target.id);
    };

    deleteButton.onclick = async () => {
      const confirmed = confirm("Delete this category?");
      if (!confirmed) return;

      const freshState = deepClone(await loadSiteState());
      freshState.categories = freshState.categories.filter((cat) => cat.id !== category.id);

      await saveSiteState(freshState);
      window.location.href = PAGE.home;
    };

    return;
  }

  if (type === "subcategory") {
    const subcategory = findSubcategoryByRaw(category, subcategoryRaw);
    if (!subcategory) {
      parentEl.textContent = "Not found";
      idEl.textContent = "";
      return;
    }

    kindEl.textContent = "EDIT SUBCATEGORY";
    parentEl.textContent = category.label;
    labelInput.value = subcategory.label;
    idEl.textContent = `ID: ${subcategory.id}`;
    backLink.href = categoryUrl(category.id, subcategory.id);

    saveButton.onclick = async () => {
      const newLabel = labelInput.value.trim();
      if (!newLabel) {
        alert("Please enter a name.");
        return;
      }

      const freshState = deepClone(await loadSiteState());
      const targetCategory = freshState.categories.find((cat) => cat.id === category.id);
      if (!targetCategory) return;

      const targetSub = targetCategory.subcategories.find((sub) => sub.id === subcategory.id);
      if (!targetSub) return;

      const oldLabel = targetSub.label;
      targetSub.aliases = uniqStrings([...(targetSub.aliases || []), oldLabel, newLabel]);
      targetSub.label = newLabel;

      await saveSiteState(freshState);
      window.location.href = categoryUrl(targetCategory.id, targetSub.id);
    };

    deleteButton.onclick = async () => {
      const confirmed = confirm("Delete this subcategory?");
      if (!confirmed) return;

      const freshState = deepClone(await loadSiteState());
      const targetCategory = freshState.categories.find((cat) => cat.id === category.id);
      if (!targetCategory) return;

      targetCategory.subcategories = targetCategory.subcategories.filter((sub) => sub.id !== subcategory.id);

      await saveSiteState(freshState);
      window.location.href = categoryUrl(category.id);
    };

    return;
  }

  window.location.href = PAGE.home;
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("login-form")) {
    await initLoginPage();
    return;
  }

  if (document.getElementById("app") && document.getElementById("dashboard")) {
    await loadHomePage();
    return;
  }

  if (document.getElementById("category-title")) {
    await loadCategoryPage();
    return;
  }

  if (document.getElementById("edit-title")) {
    await loadEditPage();
    return;
  }

  if (document.getElementById("structure-label")) {
    await loadStructureEditPage();
    return;
  }

  if (document.getElementById("article-title")) {
    await loadArticlePage();
    return;
  }

  if (document.getElementById("save-entry")) {
    await loadNewEntryPage();
  }
});

function resequenceSubcategories(category) {
  category.subcategories.forEach((sub, index) => {
    sub.position = index + 1;
  });
}

async function moveSubcategory(categoryId, subcategoryId, direction) {
  const state = deepClone(await loadSiteState());
  const category = state.categories.find((cat) => cat.id === categoryId);
  if (!category) return;

  category.subcategories.sort(
    (a, b) => (a.position ?? 9999) - (b.position ?? 9999)
  );

  const index = category.subcategories.findIndex((sub) => sub.id === subcategoryId);
  if (index < 0) return;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= category.subcategories.length) return;

  const temp = category.subcategories[index];
  category.subcategories[index] = category.subcategories[targetIndex];
  category.subcategories[targetIndex] = temp;

  resequenceSubcategories(category);
  await saveSiteState(state);
  window.location.reload();
}

async function deleteCategoryAndArticles(categoryId) {
  const state = deepClone(await loadSiteState());
  const category = state.categories.find((cat) => cat.id === categoryId);

  if (!category) return;

  const categoryVariants = getCategoryVariants(category);

  const confirmed = confirm(
    `Delete "${category.label}"?\n\nThis will also delete its articles.`
  );
  if (!confirmed) return;

  const { error: articleDeleteError } = await supabaseClient
    .from("articles")
    .delete()
    .in("category", categoryVariants);

  if (articleDeleteError) {
    alert("DELETE ERROR:\n\n" + articleDeleteError.message);
    return;
  }

  state.categories = state.categories.filter((cat) => cat.id !== categoryId);

  try {
    await saveSiteState(state);
    window.location.href = PAGE.home;
  } catch (error) {
    alert("DELETE ERROR:\n\n" + error.message);
  }
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", resize);
  window.addEventListener("load", resize);
  window.addEventListener("resize", resize);
  resize();
}

autoResizeTextarea(document.getElementById("edit-title"));


function autoGrowTitle(textarea) {
  if (!textarea) return;

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", resize);

  resize();
}