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
  let text = String(content || "");

  if (!text.trim()) return "";

  /*
   * Remove HTML tags but preserve their text.
   */
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  /*
   * Decode common HTML entities.
   */
  const temp = document.createElement("textarea");
  temp.innerHTML = text;
  text = temp.value;

  /*
   * Normalize whitespace.
   */
  text = text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();

  if (!text) return "";

  /*
   * If the text is already short enough, return it unchanged.
   */
  if (text.length <= maxLength) {
    return text;
  }

  /*
   * Build the excerpt without cutting through LaTeX.
   *
   * Supported:
   * \( ... \)
   * \[ ... \]
   * $$ ... $$
   * $ ... $
   */
  let result = "";
  let i = 0;

  while (i < text.length && result.length < maxLength) {

    /*
     * Display math: \[ ... \]
     */
    if (text.startsWith("\\[", i)) {
      const end = text.indexOf("\\]", i + 2);

      if (end !== -1) {
        const math = text.slice(i, end + 2);

        if (result.length + math.length <= maxLength) {
          result += math;
          i = end + 2;
          continue;
        }

        break;
      }
    }

    /*
     * Inline math: \( ... \)
     */
    if (text.startsWith("\\(", i)) {
      const end = text.indexOf("\\)", i + 2);

      if (end !== -1) {
        const math = text.slice(i, end + 2);

        if (result.length + math.length <= maxLength) {
          result += math;
          i = end + 2;
          continue;
        }

        break;
      }
    }

    /*
     * Display math: $$ ... $$
     */
    if (text.startsWith("$$", i)) {
      const end = text.indexOf("$$", i + 2);

      if (end !== -1) {
        const math = text.slice(i, end + 2);

        if (result.length + math.length <= maxLength) {
          result += math;
          i = end + 2;
          continue;
        }

        break;
      }
    }

    /*
     * Inline math: $ ... $
     */
    if (text[i] === "$") {
      const end = text.indexOf("$", i + 1);

      if (end !== -1) {
        const math = text.slice(i, end + 1);

        if (result.length + math.length <= maxLength) {
          result += math;
          i = end + 1;
          continue;
        }

        break;
      }
    }

    result += text[i];
    i++;
  }

  result = result.trim();

  if (result.length < text.length) {
    result += "…";
  }

  return result;
}

function renderStoredHtml(content) {
  const raw = String(content || "").trim();

  if (!raw) return "";

  /*
   * Existing HTML article.
   * Convert raw LaTeX inside the text nodes.
   */
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    const container = document.createElement("div");
    container.innerHTML = raw;

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT
    );

    const textNodes = [];

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      node.nodeValue = renderRawLatexInText(
        node.nodeValue
      );
    });

    return container.innerHTML;
  }

  /*
   * Plain text article.
   */
  return renderRawLatexInText(
    escapeHtml(raw)
  )
    .split("\n")
    .map((line) =>
      line
        ? `<p>${line}</p>`
        : "<p><br></p>"
    )
    .join("");
}


function renderRawLatexInText(text) {
  if (!text) return text;

  const protectedMath = [];

  /*
   * =========================================================
   * PROTECT EXISTING MATHJAX
   * =========================================================
   */

  text = text.replace(
    /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g,
    (match) => {
      const index = protectedMath.length;
      protectedMath.push(match);
      return `___MATH_${index}___`;
    }
  );

  /*
   * =========================================================
   * PROTECT MATRIX / DISPLAY ENVIRONMENTS
   * =========================================================
   */

  text = text.replace(
    /\\begin\{(pmatrix|bmatrix|matrix|cases|aligned|gathered|array)\}[\s\S]*?\\end\{\1\}/g,
    (match) => {
      const index = protectedMath.length;
      protectedMath.push(`\\(${match}\\)`);
      return `___MATH_${index}___`;
    }
  );

  /*
   * =========================================================
   * BASIC HELPERS
   * =========================================================
   */

  function findMatchingBrace(str, start) {
    if (str[start] !== "{") return -1;

    let depth = 0;

    for (let i = start; i < str.length; i++) {
      if (str[i] === "{") depth++;

      if (str[i] === "}") {
        depth--;

        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  function protectMath(expression) {
    const index = protectedMath.length;
    protectedMath.push(`\\(${expression}\\)`);
    return `___MATH_${index}___`;
  }

  /*
   * =========================================================
   * READ A {...} GROUP
   * =========================================================
   */

  function readGroup(str, position) {
    if (str[position] !== "{") return null;

    const end = findMatchingBrace(str, position);

    if (end === -1) return null;

    return {
      value: str.slice(position, end + 1),
      end: end + 1
    };
  }

  /*
   * =========================================================
   * READ A SUBSCRIPT OR SUPERSCRIPT
   *
   * Supports:
   *
   * _x
   * _0
   * _{x}
   * _{r_\perp}
   *
   * ^2
   * ^{2}
   * =========================================================
   */

  function readScript(str, position) {
    if (
      str[position] !== "_" &&
      str[position] !== "^"
    ) {
      return null;
    }

    let end = position + 1;

    /*
    * Braced subscript/superscript.
    *
    * Examples:
    *
    * _{r_\perp}
    * _{\perp}
    * ^{2}
    */
    if (str[end] === "{") {
      const group = readGroup(str, end);

      if (!group) return null;

      end = group.end;

      return {
        value: str.slice(position, end),
        end
      };
    }

    /*
    * Normal one-character subscript.
    *
    * Example:
    *
    * _i
    * _x
    * _0
    */

    if (/[A-Za-z0-9]/.test(str[end] || "")) {
      end++;

      return {
        value: str.slice(position, end),
        end
      };
    }

    /*
    * A LaTeX command used directly as a subscript.
    *
    * Example:
    *
    * _\perp
    * _\phi
    */

    if (str[end] === "\\") {
      const command = readCommand(str, end);

      if (!command) return null;

      end = command.end;

      return {
        value: str.slice(position, end),
        end
      };
    }

    return null;
  }

  /*
   * =========================================================
   * READ A LATEX COMMAND
   * =========================================================
   */

  function readCommand(str, position) {
    if (str[position] !== "\\") return null;

    const match = str
      .slice(position)
      .match(/^\\[A-Za-z]+/);

    if (!match) return null;

    return {
      value: match[0],
      end: position + match[0].length
    };
  }

  /*
   * =========================================================
   * COMMANDS WE CONSIDER MATHEMATICAL
   * =========================================================
   */

  const mathCommands = new Set([
    "vec",
    "dot",
    "ddot",
    "hat",
    "bar",
    "tilde",

    "frac",
    "dfrac",
    "tfrac",

    "sqrt",

    "partial",
    "nabla",
    "Delta",

    "int",
    "sum",
    "lim",

    "cdot",
    "times",
    "perp",

    "equiv",
    "neq",
    "leq",
    "geq",
    "approx",
    "sim",

    "implies",
    "to",
    "rightarrow",
    "leftarrow",

    "quad",

    "sin",
    "cos",
    "tan",
    "cot",

    "exp",
    "ln",

    "pm",
    "mp",

    "in",
    "notin",

    "alpha",
    "beta",
    "gamma",
    "Gamma",
    "delta",
    "epsilon",
    "varepsilon",
    "theta",
    "lambda",
    "mu",
    "pi",
    "rho",
    "sigma",
    "phi",
    "varphi",
    "omega",
    "Omega",
    "infty",

    "mathbf",
    "mathrm",
    "text"
  ]);

  /*
   * =========================================================
   * READ A COMPLETE LATEX EXPRESSION
   *
   * This is the important part.
   *
   * It understands combinations such as:
   *
   * \vec{f}_{r_\perp}
   *
   * \dot{\vec{e}}_{r_\perp}
   *
   * \frac{\partial \vec{r}}{\partial r_\perp}
   *
   * \sqrt{r_\perp^2(\sin^2\phi+\cos^2\phi)}
   * =========================================================
   */

  function readLatexExpression(str, start) {
    let position = start;

    const firstCommand = readCommand(str, position);

    if (!firstCommand) return null;

    const commandName =
      firstCommand.value.slice(1);

    if (!mathCommands.has(commandName)) {
      return null;
    }

    position = firstCommand.end;
    /*
    * \text{...}
    */
    if (commandName === "text") {
      if (str[position] === "{") {
        const group = readGroup(str, position);

        if (!group) return null;

        position = group.end;
      }

      return {
        value: str.slice(start, position),
        end: position
      };
    }

    /*
     * First {...} argument.
     */

    if (str[position] === "{") {
      const group = readGroup(str, position);

      if (!group) return null;

      position = group.end;
    }


    /*
    * Limits and sums can have both subscript
    * and superscript.
    *
    * \lim_{\Delta t \to 0}
    * \sum_{n=0}^{\infty}
    */

    if (
      commandName === "lim" ||
      commandName === "sum"
    ) {
      while (
        str[position] === "_" ||
        str[position] === "^"
      ) {
        const script = readScript(
          str,
          position
        );

        if (!script) break;

        position = script.end;
      }
    }


    /*
     * \frac has TWO groups.
     */

    if (
      commandName === "frac" ||
      commandName === "dfrac" ||
      commandName === "tfrac"
    ) {
      if (str[position] === "{") {
        const group = readGroup(str, position);

        if (!group) return null;

        position = group.end;
      }
    }


    
    /*
     * Subscript / superscript.
     *
     * We allow multiple ones:
     *
     * _{r_\perp}
     * ^2
     */

    while (
      str[position] === "_" ||
      str[position] === "^"
    ) {
      const script = readScript(
        str,
        position
      );

      if (!script) break;

      position = script.end;
    }

    /*
     * Function argument:
     *
     * \vec{r}(t)
     */

    if (str[position] === "(") {
      let depth = 1;
      let j = position + 1;

      while (
        j < str.length &&
        depth > 0
      ) {
        if (str[j] === "(") depth++;
        if (str[j] === ")") depth--;

        j++;
      }

      if (depth === 0) {
        position = j;
      }
    }

    /*
     * Mathematical continuation:
     *
     * \cos^2\phi
     * \sin^2\phi
     *
     * The following ordinary mathematical content
     * belongs to the expression.
     */

    if (
      ["sin", "cos", "tan"].includes(
        commandName
      )
    ) {
      while (
        str[position] === "_" ||
        str[position] === "^"
      ) {
        const script = readScript(
          str,
          position
        );

        if (!script) break;

        position = script.end;
      }

      while (
        /[A-Za-z0-9]/.test(
          str[position] || ""
        )
      ) {
        position++;
      }
    }

    return {
      value: str.slice(start, position),
      end: position
    };
  }

  /*
   * =========================================================
   * SCAN THE TEXT
   * =========================================================
   */

  let result = "";
  let i = 0;

  while (i < text.length) {

    /*
     * Existing MathJax placeholder.
     */

    if (
      text.startsWith(
        "___MATH_",
        i
      )
    ) {
      const end =
        text.indexOf(
          "___",
          i + 8
        );

      if (end !== -1) {
        result += text.slice(
          i,
          end + 3
        );

        i = end + 3;
        continue;
      }
    }

    /*
     * LaTeX command.
     */

    if (text[i] === "\\") {

      const expression =
        readLatexExpression(
          text,
          i
        );

      if (expression) {

        result += protectMath(
          expression.value
        );

        i = expression.end;

        continue;
      }
    }


    /*
    * Partial derivative notation:
    *
    * \partial_x
    * \partial_y
    * \partial_t
    */

    if (
      text.startsWith("\\partial_", i)
    ) {
      const match = text
        .slice(i)
        .match(/^\\partial_[A-Za-z0-9]+/);

      if (match) {
        result += protectMath(match[0]);

        i += match[0].length;

        continue;
      }
    }


    /*
     * Plain variable with a subscript.
     *
     * Examples:
     *
     * r_\perp
     * h_i
     * h_u
     * ds_u
     * x_0
     * y_0
     */

    if (
      /[A-Za-z]/.test(text[i]) &&
      text[i + 1] === "_"
    ) {

      let end = i + 1;

      const script =
        readScript(
          text,
          end
        );

      if (script) {

        result += protectMath(
          text.slice(
            i,
            script.end
          )
        );

        i = script.end;

        continue;
      }
    }

    /*
     * Plain variable with superscript.
     *
     * Examples:
     *
     * x^2
     * \Delta^2
     */

    if (
      /[A-Za-z]/.test(text[i]) &&
      text[i + 1] === "^"
    ) {

      const script =
        readScript(
          text,
          i + 1
        );

      if (script) {

        result += protectMath(
          text.slice(
            i,
            script.end
          )
        );

        i = script.end;

        continue;
      }
    }

    result += text[i];

    i++;
  }

  /*
   * =========================================================
   * RESTORE ORIGINAL MATHJAX
   * =========================================================
   */

  result = result.replace(
    /___MATH_(\d+)___/g,
    (_, index) =>
      protectedMath[index]
  );

  return result;
}



function buildEntryMarkup(entry, href, variant = "list") {
  const title = String(entry.title || "");
  const excerpt = getExcerpt(
    entry.content || "",
    variant === "preview" ? 170 : 170
  );

  const korean = /[가-힣]/.test(excerpt);

  if (variant === "preview") {
    return `
      <a href="${href}" class="entry-preview-item">

        <div class="entry-preview-date">
          ${formatDate(entry.created_at)}
        </div>

        <div class="entry-preview-body">

          <strong class="math-content entry-title-math">
            ${escapeHtml(title)}
          </strong>

          <span class="${korean ? "korean-excerpt" : "english-excerpt"} math-content entry-excerpt-math">
            ${escapeHtml(excerpt)}
          </span>

        </div>

      </a>
    `;
  }

  return `
    <a href="${href}" class="entry">

      <div class="entry-date">
        ${formatDate(entry.created_at)}
      </div>

      <div class="entry-body">

        <strong class="math-content entry-title-math">
          ${escapeHtml(title)}
        </strong>

        <span class="${korean ? "korean-excerpt" : "english-excerpt"} math-content entry-excerpt-math">
          ${escapeHtml(excerpt)}
        </span>

      </div>

    </a>
  `;
}

async function typesetMathIn(container) {
  if (!container) return;

  if (
    window.MathJax &&
    typeof window.MathJax.typesetPromise === "function"
  ) {
    try {
      await window.MathJax.typesetPromise([container]);
    } catch (error) {
      console.error("MATHJAX TYPESETTING ERROR:", error);
    }
  }
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

function setupLiveLatexPreview(editorId = "edit-content") {
  console.log("LIVE LATEX PREVIEW INITIALIZED");

  const editor = document.getElementById(editorId);
  const button = document.getElementById("latex-preview-btn");
  const preview = document.getElementById("latex-live-preview");

  if (!editor || !button || !preview) {
    console.error("LATEX PREVIEW: missing elements", {
      editor,
      button,
      preview
    });
    return;
  }

  let savedRange = null;


  /*
   * =========================================================
   * SAVE CURRENT SELECTION
   * =========================================================
   */

  function getSelectionRange() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    if (selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) {
      return null;
    }

    return range.cloneRange();
  }


  /*
   * =========================================================
   * POSITION PREVIEW ABOVE SELECTION
   * =========================================================
   */

  function positionPreview(range) {
    const rect = range.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const previewRect = preview.getBoundingClientRect();

    let left =
      rect.left +
      rect.width / 2 -
      previewRect.width / 2;

    let top =
      rect.top -
      previewRect.height -
      12;

    const margin = 12;

    /*
     * Keep inside viewport horizontally.
     */

    if (left < margin) {
      left = margin;
    }

    if (
      left + previewRect.width >
      window.innerWidth - margin
    ) {
      left =
        window.innerWidth -
        previewRect.width -
        margin;
    }

    /*
     * If there is not enough space above,
     * put it below the selection.
     */

    if (top < margin) {
      top = rect.bottom + 12;
    }

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }


  /*
   * =========================================================
   * SHOW PREVIEW
   * =========================================================
   */

  async function showPreview(range) {
    if (!range) {
      return;
    }

    console.log("LATEX PREVIEW: creating selected content");


    /*
     * -------------------------------------------------------
     * CLONE THE SELECTED DOM
     * -------------------------------------------------------
     */

    const fragment = range.cloneContents();

    const temporaryContainer =
      document.createElement("div");

    temporaryContainer.appendChild(fragment);


    /*
     * -------------------------------------------------------
     * IMPORTANT
     *
     * THIS IS THE SAME FUNCTION USED BY
     * YOUR NORMAL ARTICLE RENDERER:
     *
     *     articleContent.innerHTML =
     *         renderStoredHtml(data.content);
     *
     * -------------------------------------------------------
     *
     * We now pass the selected HTML through
     * renderStoredHtml() before MathJax.
     */

    const renderedHtml =
      renderStoredHtml(
        temporaryContainer.innerHTML
      );


    /*
     * -------------------------------------------------------
     * INSERT THE PROCESSED HTML
     * -------------------------------------------------------
     */

    preview.innerHTML = renderedHtml;

    preview.classList.add("visible");


    /*
     * -------------------------------------------------------
     * EXACT SAME MATHJAX LOGIC AS ARTICLE
     * -------------------------------------------------------
     */

    console.log(
      "LATEX PREVIEW: rendering with MathJax..."
    );

    await typesetMath(preview);


    /*
     * -------------------------------------------------------
     * POSITION AFTER RENDERING
     * -------------------------------------------------------
     */

    positionPreview(range);

    console.log(
      "LATEX PREVIEW: rendering complete"
    );
  }


  /*
   * =========================================================
   * HIDE PREVIEW
   * =========================================================
   */

  function hidePreview() {
    preview.classList.remove("visible");

    if (
      window.MathJax &&
      typeof window.MathJax.typesetClear === "function"
    ) {
      try {
        window.MathJax.typesetClear([preview]);
      } catch (error) {
        console.error(
          "LATEX PREVIEW: MathJax clear error",
          error
        );
      }
    }

    preview.innerHTML = "";

    preview.style.left = "";
    preview.style.top = "";

    savedRange = null;
  }


  /*
   * =========================================================
   * BUTTON
   * =========================================================
   *
   * mousedown is intentional.
   *
   * A normal click can destroy the text selection
   * before we retrieve it.
   */

  button.addEventListener(
    "mousedown",
    async (event) => {

      event.preventDefault();

      savedRange = getSelectionRange();

      if (!savedRange) {
        console.log(
          "LATEX PREVIEW: no text selected"
        );
        return;
      }

      console.log(
        "LATEX PREVIEW: selection captured"
      );

      await showPreview(savedRange);
    }
  );


  /*
   * =========================================================
   * CLOSE WHEN CLICKING OUTSIDE
   * =========================================================
   */

  document.addEventListener(
    "mousedown",
    (event) => {

      /*
      * Keep the preview open when clicking:
      * 1. The LaTeX Preview button
      * 2. Inside the preview itself
      */

      if (
        event.target === button ||
        button.contains(event.target)
      ) {
        return;
      }

      if (
        event.target === preview ||
        preview.contains(event.target)
      ) {
        return;
      }

      /*
      * Every other click closes the preview.
      *
      * This includes clicking:
      * - somewhere else in the editor
      * - another paragraph
      * - another part of the page
      * - the toolbar
      * - the title
      * - etc.
      */

      hidePreview();
    }
  );


  /*
   * =========================================================
   * KEEP PREVIEW POSITIONED
   * =========================================================
   */

  window.addEventListener(
    "scroll",
    () => {

      if (
        preview.classList.contains("visible") &&
        savedRange
      ) {
        positionPreview(savedRange);
      }

    },
    true
  );


  window.addEventListener(
    "resize",
    () => {

      if (
        preview.classList.contains("visible") &&
        savedRange
      ) {
        positionPreview(savedRange);
      }

    }
  );


  console.log(
    "LIVE LATEX PREVIEW READY"
  );
}

function setupRichEditor(
  editorId,
  uploadInputId = "image-upload",
  imageButtonId = "image-btn"
) {
  const editor = document.getElementById(editorId);
  const centerButton = document.getElementById("center-btn");
  if (centerButton) {

    centerButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    centerButton.addEventListener("click", () => {

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        editor.focus();
        return;
      }

      let node = selection.anchorNode;

      if (!node) return;

      /*
      * Find the paragraph / heading / list item
      * containing the cursor.
      */
      let block = node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : node;

      while (
        block &&
        block !== editor &&
        ![
          "P",
          "DIV",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "LI"
        ].includes(block.tagName)
      ) {
        block = block.parentElement;
      }

      if (!block || block === editor) {
        editor.focus();
        return;
      }

      /*
      * Center ONLY this block.
      */
      block.style.textAlign = "center";

      editor.focus();
    });

    /*
    * Double click = return this same block
    * to normal left alignment.
    */
    centerButton.addEventListener("dblclick", (event) => {

      event.preventDefault();

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        editor.focus();
        return;
      }

      let node = selection.anchorNode;

      if (!node) return;

      let block = node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : node;

      while (
        block &&
        block !== editor &&
        ![
          "P",
          "DIV",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "LI"
        ].includes(block.tagName)
      ) {
        block = block.parentElement;
      }

      if (!block || block === editor) {
        editor.focus();
        return;
      }

      block.style.textAlign = "left";

      editor.focus();
    });
  }
  const toolbar = document.querySelector(".editor-toolbar");
  
  /*
  * HIGHLIGHT DOUBLE CLICK
  *
  * Double click a highlight button
  * to remove the highlight from the selected text.
  */

  document.querySelectorAll(".hl").forEach((button) => {

    button.addEventListener("dblclick", (event) => {

      event.preventDefault();
      event.stopPropagation();

      document.execCommand(
        "hiliteColor",
        false,
        "transparent"
      );

      document.execCommand(
        "backColor",
        false,
        "transparent"
      );

      editor.focus();
    });

  });
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
  * HEADINGS
  */

  if (cmd === "formatBlock") {
    const format = button.dataset.format;

    if (format) {
      document.execCommand("formatBlock", false, format);
    }

    editor.focus();
    return;
  }

    /*
    * NORMAL TEXT
    * Keep all inline formatting.
    * Normalize only font size and line spacing.
    */

    if (cmd === "normalText") {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        editor.focus();
        return;
      }

      const range = selection.getRangeAt(0);

      if (!editor.contains(range.commonAncestorContainer)) {
        editor.focus();
        return;
      }

      const fragment = range.cloneContents();

      const wrapper = document.createElement("span");
      wrapper.className = "normal-text-format";
      wrapper.appendChild(fragment);

      range.deleteContents();
      range.insertNode(wrapper);

      editor.focus();
      return;
    }

    /*
    * NORMAL TEXT
    */

    if (cmd === "normal") {
      document.execCommand("formatBlock", false, "p");
      document.execCommand("removeFormat", false, null);
      editor.focus();
      return;
    }

    /*
    * HIGHLIGHT
    *
    * Click once:
    * - unhighlight the selected text if it is already highlighted
    * - otherwise apply the selected highlight color
    *
    * Only the current selection is affected.
    */

    if (button.classList.contains("hl")) {

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        editor.focus();
        return;
      }

      const range = selection.getRangeAt(0);

      if (
        range.collapsed ||
        !editor.contains(range.commonAncestorContainer)
      ) {
        editor.focus();
        return;
      }

      /*
      * Find all text nodes touched by the selection.
      */
      const walker = document.createTreeWalker(
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentNode
          : range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT
      );

      const textNodes = [];

      let node;

      while ((node = walker.nextNode())) {

        if (!node.textContent.trim()) continue;

        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);

        const startsBeforeEnd =
          range.compareBoundaryPoints(
            Range.START_TO_END,
            nodeRange
          ) > 0;

        const endsAfterStart =
          range.compareBoundaryPoints(
            Range.END_TO_START,
            nodeRange
          ) < 0;

        if (startsBeforeEnd && endsAfterStart) {
          textNodes.push(node);
        }
      }

      /*
      * Check whether ALL selected text is already highlighted.
      */
      const allHighlighted =
        textNodes.length > 0 &&
        textNodes.every((textNode) => {

          const parent = textNode.parentElement;

          if (!parent) return false;

          const background =
            window.getComputedStyle(parent).backgroundColor;

          return (
            background !== "transparent" &&
            background !== "rgba(0, 0, 0, 0)" &&
            background !== "rgb(255, 255, 255)"
          );
        });

      /*
      * If the entire selection is highlighted,
      * remove the highlight ONLY from this selection.
      */
      if (allHighlighted) {

        document.execCommand(
          "hiliteColor",
          false,
          "transparent"
        );

        document.execCommand(
          "backColor",
          false,
          "transparent"
        );

      } else {

        /*
        * Otherwise apply the selected color
        * ONLY to the current selection.
        */
        document.execCommand(
          "hiliteColor",
          false,
          button.dataset.color
        );
      }

      editor.focus();
      return;
    }

    

    /*
    * CLEAR ALL FORMATTING
    */

    if (button.id === "clear-format-btn") {
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
      document.execCommand("formatBlock", false, "p");
      document.execCommand("justifyLeft", false, null);

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

    /*
     * MIDDLE CENTRE
     */

    const centerButton = document.getElementById("center-btn");

    if (centerButton) {
      centerButton.addEventListener("dblclick", (event) => {
        event.preventDefault();

        document.execCommand(
          "justifyLeft",
          false,
          null
        );

        editor.focus();
      });
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
    * Preserve the formatting when copying from our own editor.
    */
    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const yenaContent = doc.querySelector('[data-yena-content="true"]');

      if (yenaContent) {
        document.execCommand(
          "insertHTML",
          false,
          yenaContent.innerHTML
        );

        return;
      }

      /*
      * Browsers sometimes remove custom data attributes
      * from clipboard HTML.
      *
      * If the HTML looks like our editor's formatting,
      * preserve the useful formatting instead of converting
      * everything to plain text.
      */
      const hasOurFormatting =
        doc.querySelector(
          "strong, b, em, i, u, mark, ul, ol, li, blockquote, a, img"
        );

      if (hasOurFormatting) {
        const body = doc.body;

        /*
        * Remove external styling that we don't want.
        * Keep the actual semantic formatting.
        */
        body.querySelectorAll("*").forEach((element) => {
          element.removeAttribute("style");
          element.removeAttribute("class");
          element.removeAttribute("id");

          /*
          * Keep only useful attributes.
          */
          [...element.attributes].forEach((attr) => {
            if (
              attr.name !== "href" &&
              attr.name !== "src" &&
              attr.name !== "alt"
            ) {
              element.removeAttribute(attr.name);
            }
          });
        });

        document.execCommand(
          "insertHTML",
          false,
          body.innerHTML
        );

        return;
      }
    }

    /*
    * EXTERNAL PLAIN TEXT
    * Convert pasted text into our normal line structure.
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

  setupLiveLatexPreview(editorId);

}

function setupArticleTOC() {
  const editContent = document.getElementById("edit-content");
  const articleContent = document.getElementById("article-content");
  const toc = document.getElementById("article-toc");

  console.log("=== TOC ===");
  console.log("edit content:", editContent);
  console.log("article content:", articleContent);
  console.log("toc:", toc);

  // Use the content that exists on the current page
  const content = editContent || articleContent;

  if (!content || !toc) {
    console.log("TOC: missing content or TOC");
    return;
  }

  // Find all headings
  const headings = content.querySelectorAll("h1, h2, h3");

  console.log("TOC headings:", headings);

  // Nothing to show
  if (!headings.length) {
    toc.innerHTML = "";
    return;
  }

  // Clear old TOC
  toc.innerHTML = "";

  // Create TOC items
  headings.forEach((heading, index) => {
    if (!heading.id) {
      heading.id = `toc-heading-${index}`;
    }

    const item = document.createElement("button");

    item.type = "button";

    item.className =
      `article-toc-item article-toc-${heading.tagName.toLowerCase()}`;

    item.textContent = heading.textContent.trim();

    item.dataset.target = heading.id;

    item.addEventListener("click", () => {
      const offset = 110;

      const targetPosition =
        heading.getBoundingClientRect().top +
        window.scrollY -
        offset;

      window.scrollTo({
        top: targetPosition,
        behavior: "smooth"
      });
    });

    toc.appendChild(item);
  });

  // All TOC buttons
  const tocItems = Array.from(
    toc.querySelectorAll(".article-toc-item")
  );

  // Highlight the heading currently visible
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        tocItems.forEach((item) => {
          item.classList.remove("active");
        });

        const activeItem = tocItems.find(
          (item) => item.dataset.target === entry.target.id
        );

        if (activeItem) {
          activeItem.classList.add("active");
        }
      });
    },
    {
      rootMargin: "-15% 0px -70% 0px",
      threshold: 0
    }
  );

  headings.forEach((heading) => {
    observer.observe(heading);
  });

  console.log("TOC initialized successfully.");
}

function setupLiveArticleTOC() {
  const editor = document.getElementById("edit-content");

  if (!editor) return;

  let updateTimer = null;

  editor.addEventListener("input", () => {
    clearTimeout(updateTimer);

    updateTimer = setTimeout(() => {
      setupArticleTOC();
      setupLiveArticleTOC();
    }, 100);
  });
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

  await typesetMath(titleEl);

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
    await typesetMath(pathEl);

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

    await typesetMath(entriesContainer);

    console.log(
      "EXCERPT CLASS:",
      entriesContainer.querySelector(".english-excerpt")?.className
    );

    console.log(
      "EXCERPT:",
      entriesContainer.querySelector(".english-excerpt")?.innerHTML
    );

    console.log(
      "EXCERPT MATHJAX:",
      entriesContainer.querySelector(".english-excerpt mjx-container")
    );

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

    await typesetMath(titleEl);
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

              <h2 class="subcategory-title">
                ${escapeHtml(sub.label)}
              </h2>
            </div>

            <span class="arrow">↗︎</span>
          </a>
        `
      )
      .join("");

    /*
    * The subcategory HTML has just been inserted.
    * Render any LaTeX inside the subcategory names.
    */

    await typesetMath(subcategoryList);

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


function autoGrowTitle(textarea) {
  if (!textarea) return;

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", resize);

  resize();
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

  setupLiveLatexPreview("edit-content");
}

async function typesetMath(element) {
  if (!element) return;

  if (!window.MathJax || !window.MathJax.typesetPromise) {
    return;
  }

  try {
    await window.MathJax.typesetPromise([element]);
  } catch (error) {
    console.error("MATHJAX ERROR:", error);
  }
}

async function typesetEntryTitles(container) {
  if (!container) return;

  if (!window.MathJax || !window.MathJax.typesetPromise) return;

  const titles = container.querySelectorAll(".entry-title-math");

  if (!titles.length) return;

  try {
    await MathJax.typesetPromise([...titles]);
  } catch (error) {
    console.error("ENTRY TITLE MATH ERROR:", error);
  }
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

  if (!articleTitle || !articleMeta || !articleContent || !articleCategory) {
    return;
  }

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
    articleContent.innerHTML =
      "<p>This article could not be loaded.</p>";

    return;
  }

  const category = findCategoryByRaw(categories, data.category);

  const subcategory = category
    ? findSubcategoryByRaw(category, data.subcategory)
    : null;

  const categoryId = category
    ? category.id
    : data.category;

  const subcategoryId = subcategory
    ? subcategory.id
    : data.subcategory;

  const categoryText = category
    ? category.label
    : data.category;

  const subcategoryText = subcategory
    ? subcategory.label
    : data.subcategory;

  /*
   * CATEGORY / SUBCATEGORY PATH
   */

  if (subcategoryText) {
    articleCategory.innerHTML = `
      <a href="${categoryUrl(categoryId)}">
        ${escapeHtml(categoryText)}
      </a>
      /
      <a href="${categoryUrl(categoryId, subcategoryId)}">
        ${escapeHtml(subcategoryText)}
      </a>
    `;
  } else {
    articleCategory.innerHTML = `
      <a href="${categoryUrl(categoryId)}">
        ${escapeHtml(categoryText)}
      </a>
    `;
  }

  /*
   * TITLE
   *
   * Keep the raw LaTeX in the DOM.
   * MathJax will render it afterwards.
   */

  articleTitle.textContent = data.title || "";

  /*
   * CONTENT
   */

  articleMeta.textContent = formatDateTime(data.created_at);

    articleContent.innerHTML = renderStoredHtml(data.content);

    console.log(
      "ARTICLE HTML BEFORE MATHJAX:",
      articleContent.innerHTML
    );

    console.log(
      "ARTICLE TEXT BEFORE MATHJAX:",
      articleContent.textContent
    );

    console.log(
      "MATHJAX:",
      window.MathJax
    );

    if (window.MathJax) {
      await MathJax.typesetPromise([articleContent]);
    }

    setupArticleTOC();
    setupLiveArticleTOC();

  /*
   * RENDER LATEX
   */

  await typesetMath(articleTitle);
  await typesetMath(articleCategory);
  await typesetMath(articleContent);

  /*
   * BACK BUTTON
   */

  if (backLink) {
    backLink.href = categoryUrl(
      categoryId,
      subcategoryId
    );
  }

  /*
   * EDIT BUTTON
   */

  if (editButton) {
    editButton.href = `${PAGE.edit}?id=${id}`;
  }

  /*
   * ENTRY PREVIEW
   */

  if (entryPreview) {
    const categoryVariants = category
      ? getCategoryVariants(category)
      : uniqStrings([data.category]);

    const subcategoryVariants = subcategory
      ? getSubcategoryVariants(subcategory)
      : uniqStrings([data.subcategory]);

    let query = supabaseClient
      .from("articles")
      .select(
        "id, title, created_at, content, category, subcategory"
      )
      .in("category", categoryVariants);

    if (subcategoryText) {
      query = query.in(
        "subcategory",
        subcategoryVariants
      );
    }

    const {
      data: siblingEntries,
      error: siblingsError
    } = await query.order("created_at", {
      ascending: false
    });

    if (siblingsError) {
      console.error(
        "LOAD PREVIEW ERROR:",
        siblingsError
      );

      entryPreview.innerHTML =
        "<p class='empty-state'>Could not load other entries.</p>";

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
      .map((entry) =>
        buildEntryMarkup(
          entry,
          `${PAGE.article}?id=${entry.id}`,
          "preview"
        )
      )
      .join("");

    await typesetMathIn(entryPreview);

    /*
     * IMPORTANT:
     * The preview was just inserted into the DOM.
     * Tell MathJax to render its LaTeX.
     */

    await typesetMath(entryPreview);
  }
}

async function loadEditPage() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  const titleInput = document.querySelector(".title-input");
  const contentEditor = document.getElementById("edit-content");
  const saveStatus = document.getElementById("save-status");
  const categoryLabel = document.getElementById("article-category");
  const meta = document.getElementById("edit-meta");
  const backLink = document.getElementById("back-link");
  const saveButton = document.getElementById("save-edit-button");
  const deleteButton = document.getElementById("delete-edit-button");

  if (
    !titleInput ||
    !contentEditor ||
    !saveStatus ||
    !categoryLabel ||
    !meta ||
    !saveButton ||
    !deleteButton
  ) {
    return;
  }

  /*
   * =========================================================
   * INITIAL SETUP
   * =========================================================
   */

  autoGrowTitle(titleInput);

  setupRichEditor(
    "edit-content",
    "image-upload",
    "image-btn"
  );

  const state = await loadSiteState();
  const categories = state.categories || [];

  const id = getParam("id");

  if (!id) {
    meta.textContent = "No article id provided.";
    saveStatus.textContent = "UNSAVED";
    return;
  }

  /*
   * =========================================================
   * LOAD ARTICLE
   * =========================================================
   */

  const { data, error } = await supabaseClient
    .from("articles")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error(
      "LOAD EDIT ARTICLE ERROR:",
      error
    );

    meta.textContent = "Could not load article.";
    saveStatus.textContent = "LOAD FAILED";

    return;
  }

  /*
   * =========================================================
   * CATEGORY
   * =========================================================
   */

  const category = findCategoryByRaw(
    categories,
    data.category
  );

  const subcategory = category
    ? findSubcategoryByRaw(
        category,
        data.subcategory
      )
    : null;

  /*
   * =========================================================
   * PUT ARTICLE INTO EDITOR
   * =========================================================
   */

  titleInput.value = data.title || "";

  contentEditor.innerHTML =
    data.content || "";

  autoGrowTitle(titleInput);

  setupArticleTOC();
  setupLiveArticleTOC();

  categoryLabel.textContent = subcategory
    ? `${
        category
          ? category.label
          : data.category
      } / ${subcategory.label}`
    : (
        category
          ? category.label
          : data.category
      );

  meta.textContent =
    formatDateTime(data.created_at);

  if (backLink) {
    backLink.href =
      `${PAGE.article}?id=${id}`;
  }

  /*
   * =========================================================
   * AUTOSAVE STATE
   * =========================================================
   */

  let autosaveTimer = null;
  let autosaveInProgress = false;
  let autosaveQueued = false;

  /*
   * The time of the version currently saved
   * in the database.
   */

  let lastSavedAt = data.updated_at
    ? new Date(data.updated_at)
    : new Date(data.created_at);

  /*
   * =========================================================
   * SAVE STATUS
   * =========================================================
   */

  function formatLastSavedTime(date) {
    if (!date) {
      return "LAST SAVED";
    }

    const now = new Date();

    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const time = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    if (isToday) {
      return `LAST SAVED AT ${time}`;
    }

    const dateText = date.toLocaleDateString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    return `LAST SAVED AT ${dateText} ${time}`;
  }

  function showSavedStatus() {
    setSaveStatus("SAVED");
  }

  function showUnsavedStatus() {
    setSaveStatus(
      formatLastSavedTime(lastSavedAt)
    );
  }

  function setSaveStatus(text) {
    saveStatus.textContent = text;
  }

  /*
   * =========================================================
   * GET CURRENT CONTENT
   * =========================================================
   */

  function getCurrentArticleData() {
    const title =
      titleInput.value.trim();

    const content =
      contentEditor.innerHTML
        .replace(/&nbsp;/g, " ")
        .replace(/\u00A0/g, " ")
        .trim();

    return {
      title,
      content
    };
  }

  /*
   * =========================================================
   * ACTUALLY SAVE TO SUPABASE
   * =========================================================
   */

  async function saveArticleToDatabase() {
    const {
      title,
      content
    } = getCurrentArticleData();

    /*
     * Do not save an empty/incomplete article.
     */

    if (
      !title ||
      !hasRenderableContent(content)
    ) {
      showUnsavedStatus();
      return false;
    }

    /*
     * If a save is already happening,
     * remember that another save is needed.
     */

    if (autosaveInProgress) {
      autosaveQueued = true;
      return false;
    }

    /*
     * =====================================================
     * START REAL DATABASE SAVE
     * =====================================================
     */

    autosaveInProgress = true;

    setSaveStatus("SAVING …");

    console.log(
      "AUTOSAVE: saving article",
      id
    );

    const {
      error: updateError
    } = await supabaseClient
      .from("articles")
      .update({
        title: title,
        content: content
      })
      .eq("id", id);

    /*
     * =====================================================
     * SAVE FINISHED
     * =====================================================
     */

    autosaveInProgress = false;

    if (updateError) {
      console.error(
        "AUTOSAVE ERROR:",
        updateError
      );

      setSaveStatus("SAVE FAILED");

      return false;
    }

    /*
     * =====================================================
     * CONFIRMED SAVED
     * =====================================================
     *
     * The database has actually accepted the update.
     * Only now do we update lastSavedAt.
     */

    lastSavedAt = new Date();

    showSavedStatus();

    console.log(
      "AUTOSAVE: successfully saved"
    );

    /*
     * If the user typed while the previous save
     * was happening, save the newest version.
     */

    if (autosaveQueued) {
      autosaveQueued = false;

      setTimeout(() => {
        saveArticleToDatabase();
      }, 0);
    }

    return true;
  }

  /*
   * =========================================================
   * SCHEDULE AUTOSAVE
   * =========================================================
   */

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);

    /*
     * There are now unsaved changes.
     * Show when the previous version was saved.
     */

    showUnsavedStatus();

    autosaveTimer = setTimeout(
      async () => {
        await saveArticleToDatabase();
      },
      1000
    );
  }

  /*
   * =========================================================
   * WATCH TITLE
   * =========================================================
   */

  titleInput.addEventListener(
    "input",
    () => {
      autoGrowTitle(titleInput);
      scheduleAutosave();
    }
  );

  /*
   * =========================================================
   * WATCH CONTENT
   * =========================================================
   */

  contentEditor.addEventListener(
    "input",
    () => {
      scheduleAutosave();
    }
  );

  /*
   * =========================================================
   * MANUAL SAVE BUTTON
   * =========================================================
   */

  saveButton.onclick = async () => {
    clearTimeout(autosaveTimer);

    const saved =
      await saveArticleToDatabase();

    if (!saved) {
      return;
    }

    window.location.href =
      `${PAGE.article}?id=${id}`;
  };

  /*
   * =========================================================
   * DELETE
   * =========================================================
   */

  deleteButton.onclick = async () => {
    const confirmed =
      confirm("Delete this article?");

    if (!confirmed) {
      return;
    }

    clearTimeout(autosaveTimer);

    const {
      error: deleteError
    } = await supabaseClient
      .from("articles")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error(
        "DELETE ERROR:",
        deleteError
      );

      alert(
        "DELETE ERROR:\n\n" +
        deleteError.message
      );

      return;
    }

    const categoryId =
      category
        ? category.id
        : data.category;

    const subcategoryId =
      subcategory
        ? subcategory.id
        : data.subcategory;

    window.location.href =
      categoryUrl(
        categoryId,
        subcategoryId
      );
  };

  /*
   * =========================================================
   * INITIAL STATUS
   * =========================================================
   *
   * The article was loaded directly from the database,
   * so there are currently NO unsaved changes.
   */

  showSavedStatus();
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


