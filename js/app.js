(function () {
  "use strict";

  const THEME_KEY = "srcsetbuilder-theme";
  const SETTINGS_KEY = "srcsetbuilder-settings";
  const DEFAULT_SIZES =
    "(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 1200px";

  const CANVAS_MIME_MAP = {
    webp: "image/webp",
    jpg: "image/jpeg",
    png: "image/png",
    avif: "image/avif",
  };

  const PRESETS = {
    hero: {
      widths: [480, 768, 1024, 1280, 1600, 1920],
      sizes: "100vw",
    },
    card: {
      widths: [320, 480, 640, 768],
      sizes:
        "(max-width: 480px) 50vw, (max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw",
    },
    sidebar: {
      widths: [240, 320, 480, 600, 800],
      sizes: "(max-width: 480px) 50vw, (max-width: 768px) 45vw, 300px",
    },
    article: {
      widths: [480, 640, 768, 960, 1200, 1600],
      sizes: "(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 800px",
    },
    thumbnail: {
      widths: [120, 240, 360, 480, 600],
      sizes: "(max-width: 480px) 50vw, (max-width: 768px) 33vw, 120px",
    },
    product: {
      widths: [400, 600, 800, 1000, 1200],
      sizes: "(max-width: 480px) 100vw, (max-width: 1024px) 50vw, 600px",
    },
  };

  const DEVICE_PROFILES = [
    { label: "iPhone SE", viewport: 375, dpr: 2 },
    { label: "iPhone 14 Pro", viewport: 393, dpr: 3 },
    { label: "iPad", viewport: 768, dpr: 2 },
    { label: "Laptop 1280", viewport: 1280, dpr: 1 },
    { label: "Desktop 1920", viewport: 1920, dpr: 1 },
  ];

  /** @type {HTMLImageElement|null} */
  let uploadedImage = null;
  let outputMode = "img";
  let descriptorMode = "width";
  /** @type {Object.<number, number>} Width in px to estimated file size in bytes. */
  let sizeEstimates = {};
  /** @type {boolean} Whether this browser supports AVIF encoding via Canvas. */
  let avifSupported = false;
  /** @type {boolean} True once the user has manually edited the alt text field. */
  let altTextTouched = false;
  /** @type {string|null} Key of the last-selected preset, or null if none. */
  let activePreset = null;

  /**
   * Tests whether the browser can encode AVIF via canvas.toBlob.
   * Resolves to true only if a non-trivial AVIF blob is returned.
   * @return {Promise<boolean>}
   */
  function detectAvifSupport() {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = 4;
      canvas.height = 4;
      canvas.toBlob(
        (blob) => resolve(blob != null && blob.size > 0),
        "image/avif",
      );
    });
  }

  /**
   * Applies a theme to the document and updates the toggle button state.
   * @param {string} theme - "light" or "dark"
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const isDark = theme === "dark";
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode",
    );
  }

  /**
   * Reads saved or system theme preference and applies it.
   */
  function initializeTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      applyTheme(stored);
      return;
    }
    applyTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    );
  }

  /**
   * Toggles between light and dark themes and persists the choice.
   */
  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  /**
   * Converts a free-form width list into unique ascending integer widths.
   * @param {string} raw
   * @return {number[]}
   */
  function parseWidths(raw) {
    const tokens = raw.split(/[\s,]+/g).filter(Boolean);
    const widths = new Set();

    for (const token of tokens) {
      const parsed = Number.parseInt(token, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        widths.add(parsed);
      }
    }

    return Array.from(widths).sort((a, b) => a - b);
  }

  /**
   * Escapes text for safe HTML attribute insertion.
   * @param {string} text
   * @return {string}
   */
  function escapeAttribute(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  /**
   * Evaluates a simple CSS media condition against a viewport width.
   * Supports max-width and min-width with px, em, rem units.
   * @param {string} condition
   * @param {number} viewportWidth
   * @return {boolean}
   */
  function evaluateMediaCondition(condition, viewportWidth) {
    const maxW = condition.match(/max-width:\s*([\d.]+)(px|em|rem)?/i);
    const minW = condition.match(/min-width:\s*([\d.]+)(px|em|rem)?/i);
    if (maxW) {
      const val = parseFloat(maxW[1]);
      const unit = maxW[2] || "px";
      const px = unit === "em" || unit === "rem" ? val * 16 : val;
      return viewportWidth <= px;
    }
    if (minW) {
      const val = parseFloat(minW[1]);
      const unit = minW[2] || "px";
      const px = unit === "em" || unit === "rem" ? val * 16 : val;
      return viewportWidth >= px;
    }
    return false;
  }

  /**
   * Parses a CSS length value (px or vw) relative to a viewport width.
   * @param {string} value
   * @param {number} viewportWidth
   * @return {number}
   */
  function parseCSSLength(value, viewportWidth) {
    const vw = value.match(/^([\d.]+)vw$/i);
    const px = value.match(/^([\d.]+)px$/i);
    if (vw) return Math.round((parseFloat(vw[1]) / 100) * viewportWidth);
    if (px) return Math.round(parseFloat(px[1]));
    return viewportWidth;
  }

  /**
   * Evaluates the sizes attribute expression for a given viewport width.
   * @param {string} sizesStr
   * @param {number} viewportWidth
   * @return {number} Computed image display width in px.
   */
  function parseSizesForViewport(sizesStr, viewportWidth) {
    const parts = sizesStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      const condMatch = part.match(/^\(([^)]+)\)\s+(.+)$/);
      if (condMatch) {
        if (evaluateMediaCondition(condMatch[1], viewportWidth)) {
          return parseCSSLength(condMatch[2].trim(), viewportWidth);
        }
      } else {
        return parseCSSLength(part, viewportWidth);
      }
    }
    return viewportWidth;
  }

  /**
   * Returns the smallest srcset candidate width that covers the needed pixel count.
   * Falls back to the largest candidate if none is wide enough.
   * @param {number[]} candidateWidths - sorted ascending
   * @param {number} neededPx
   * @return {number}
   */
  function selectCandidate(candidateWidths, neededPx) {
    for (const w of candidateWidths) {
      if (w >= neededPx) return w;
    }
    return candidateWidths[candidateWidths.length - 1];
  }

  /**
   * Builds srcset candidate strings, respecting the current descriptor mode.
   * @param {string} baseName
   * @param {string} extension
   * @param {number[]} widths
   * @return {{src: string, srcset: string, candidates: string[]}}
   */
  function buildCandidates(baseName, extension, widths) {
    const candidates =
      descriptorMode === "density"
        ? widths.map((w, i) => `${baseName}-${w}.${extension} ${i + 1}x`)
        : widths.map((w) => `${baseName}-${w}.${extension} ${w}w`);
    const src = `${baseName}-${widths[widths.length - 1]}.${extension}`;
    return { src, srcset: candidates.join(",\n       "), candidates };
  }

  /**
   * Sets the footer year to the current year.
   */
  function setFooterYear() {
    const yearEl = document.getElementById("footer-year");
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  /**
   * Renders individual srcset candidates in table format.
   * @param {HTMLElement} tableBody
   * @param {number[]} widths
   * @param {string[]} candidates
   */
  function renderCandidateTable(tableBody, widths, candidates) {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    const firstTh = tableBody
      .closest("table")
      ?.querySelector("thead th:first-child");
    if (firstTh) {
      firstTh.textContent =
        descriptorMode === "density" ? "Descriptor" : "Width";
    }

    if (widths.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="4">No candidate widths parsed yet.</td>';
      tableBody.appendChild(tr);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < widths.length; i += 1) {
      const width = widths[i];
      const candidate = candidates[i] ?? "";
      const descriptor =
        descriptorMode === "density" ? `${i + 1}x` : `${width}px`;
      const bytes = sizeEstimates[width];
      const sizeCell =
        bytes != null
          ? `~${Math.round(bytes / 1024)} KB`
          : uploadedImage
            ? `<span class="estimate-pending">Estimating\u2026</span>`
            : `<span class="estimate-pending">\u2014</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${descriptor}</td>` +
        `<td><code>${candidate}</code></td>` +
        `<td class="candidate-table__size" data-width="${width}">${sizeCell}</td>` +
        `<td><button class="candidate-copy-btn" type="button" ` +
        `aria-label="Copy this candidate string" ` +
        `data-candidate="${escapeAttribute(candidate)}">Copy</button></td>`;
      fragment.appendChild(tr);
    }
    tableBody.appendChild(fragment);

    tableBody.querySelectorAll(".candidate-copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.dataset.candidate ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 1500);
        });
      });
    });
  }

  /**
   * Renders the DPR coverage analysis panel for common device profiles.
   * @param {number[]} widths - sorted ascending candidate widths
   * @param {string} sizesStr - raw sizes attribute value
   */
  function renderDPRCoverage(widths, sizesStr) {
    const panel = document.getElementById("dpr-panel");
    const tbody = document.getElementById("dpr-table-body");
    if (!panel || !tbody) return;

    const fragment = document.createDocumentFragment();
    for (const profile of DEVICE_PROFILES) {
      const renderedWidth = parseSizesForViewport(sizesStr, profile.viewport);
      const neededPx = Math.round(renderedWidth * profile.dpr);
      const selected = selectCandidate(widths, neededPx);
      const ratio = selected / neededPx;
      const isGood = ratio >= 1 && ratio <= 1.3;
      const statusLabel = isGood
        ? "Good"
        : ratio < 1
          ? "Undersized"
          : "Oversized";
      const statusClass = isGood
        ? "dpr-table__status--good"
        : ratio > 1.3
          ? "dpr-table__status--over"
          : "dpr-table__status--under";
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${profile.label}</td>` +
        `<td>${profile.viewport}px</td>` +
        `<td>${profile.dpr}x</td>` +
        `<td>${renderedWidth}px</td>` +
        `<td>${neededPx}px</td>` +
        `<td>${selected}px</td>` +
        `<td><span class="dpr-table__status ${statusClass}">${statusLabel}</span></td>`;
      fragment.appendChild(tr);
    }
    tbody.replaceChildren(fragment);
    panel.hidden = false;
  }

  /**
   * Resizes each candidate width in the background and updates the table with kb estimates.
   */
  async function estimateCandidateSizes() {
    if (!uploadedImage) return;
    const extension = document.getElementById("extension")?.value ?? "webp";
    if (extension === "avif" && !avifSupported) return;
    const mimeType = CANVAS_MIME_MAP[extension] ?? "image/webp";
    const quality = extension === "png" ? 1 : getQuality();
    const widths = parseWidths(document.getElementById("widths")?.value ?? "");
    for (const width of widths) {
      if (sizeEstimates[width] != null) continue;
      try {
        const blob = await resizeImageToBlob(
          uploadedImage,
          width,
          mimeType,
          quality,
        );
        sizeEstimates[width] = blob.size;
        const cell = document.querySelector(
          `.candidate-table__size[data-width="${width}"]`,
        );
        if (cell) {
          cell.textContent = `~${Math.round(blob.size / 1024)} KB`;
        }
      } catch {
        // Leave cell as pending.
      }
    }
  }

  /** Persists current form state and mode flags to localStorage. */
  function saveSettings() {
    const settings = {
      baseName: document.getElementById("base-name")?.value ?? "",
      imagePath: document.getElementById("image-path")?.value ?? "",
      extension: document.getElementById("extension")?.value ?? "webp",
      widths: document.getElementById("widths")?.value ?? "",
      sizes: document.getElementById("sizes")?.value ?? "",
      altText: document.getElementById("alt-text")?.value ?? "",
      className: document.getElementById("class-name")?.value ?? "",
      imgWidth: document.getElementById("img-width")?.value ?? "",
      imgHeight: document.getElementById("img-height")?.value ?? "",
      loadingMode: document.getElementById("loading-mode")?.value ?? "lazy",
      decodingMode: document.getElementById("decoding-mode")?.value ?? "async",
      fetchPriority: document.getElementById("fetch-priority")?.value ?? "",
      crossOrigin: document.getElementById("cross-origin")?.value ?? "",
      quality: document.getElementById("quality-slider")?.value ?? "85",
      outputMode,
      descriptorMode,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable.
    }
  }

  /** Restores saved settings from localStorage into the form. */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null && val !== "") el.value = val;
      };
      setVal("base-name", s.baseName);
      setVal("image-path", s.imagePath);
      setVal("extension", s.extension);
      setVal("widths", s.widths);
      setVal("sizes", s.sizes);
      setVal("alt-text", s.altText);
      setVal("class-name", s.className);
      setVal("img-width", s.imgWidth);
      setVal("img-height", s.imgHeight);
      setVal("loading-mode", s.loadingMode);
      setVal("decoding-mode", s.decodingMode);
      setVal("fetch-priority", s.fetchPriority);
      setVal("cross-origin", s.crossOrigin);
      setVal("quality-slider", s.quality);
      updateQualityLabel();
      if (s.outputMode === "picture") setOutputMode("picture");
      if (s.descriptorMode === "density") setDescriptorMode("density");
    } catch {
      // Corrupt settings; ignore.
    }
  }

  /**
   * Sets the output mode and syncs toggle button state.
   * @param {string} mode - "img" | "picture"
   */
  function setOutputMode(mode) {
    outputMode = mode;
    [
      ["mode-img", "img"],
      ["mode-picture", "picture"],
    ].forEach(([id, val]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle("mode-btn--active", mode === val);
      btn.setAttribute("aria-pressed", String(mode === val));
    });
  }

  /**
   * Sets descriptor mode and shows or hides the sizes field.
   * @param {string} mode - "width" | "density"
   */
  function setDescriptorMode(mode) {
    descriptorMode = mode;
    [
      ["desc-width", "width"],
      ["desc-density", "density"],
    ].forEach(([id, val]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle("mode-btn--active", mode === val);
      btn.setAttribute("aria-pressed", String(mode === val));
    });
    const sizesGroup = document.getElementById("sizes-group");
    if (sizesGroup) sizesGroup.hidden = mode === "density";
  }

  /**
   * Returns the current quality value from the slider (0 to 1).
   * @return {number}
   */
  function getQuality() {
    const slider = document.getElementById("quality-slider");
    return slider ? parseFloat(slider.value) / 100 : 0.85;
  }

  /** Syncs the quality percentage label to the current slider value. */
  function updateQualityLabel() {
    const slider = document.getElementById("quality-slider");
    const label = document.getElementById("quality-value");
    if (slider && label) label.textContent = slider.value;
  }

  /** Reads form state, generates markup, and updates all output elements. */
  function doRender() {
    const outputEl = document.getElementById("tool-output");
    const resultMeta = document.getElementById("result-meta");
    const copyBtn = document.getElementById("copy-btn");
    const { markup, note, canCopy } = generateMarkup();
    if (outputEl) outputEl.textContent = markup;
    if (resultMeta) resultMeta.textContent = note;
    if (copyBtn) copyBtn.disabled = !canCopy;
  }

  /**
   * Hides secondary output panels (gap warning, DPR, preload) during invalid form states.
   */
  function hideSecondaryPanels() {
    const gapWarning = document.getElementById("candidate-gap-warning");
    const dprPanel = document.getElementById("dpr-panel");
    const preloadSection = document.getElementById("preload-section");
    if (gapWarning) gapWarning.hidden = true;
    if (dprPanel) dprPanel.hidden = true;
    if (preloadSection) preloadSection.hidden = true;
  }

  /**
   * Generates final image markup from all current form values.
   * @return {{markup: string, note: string, canCopy: boolean}}
   */
  function generateMarkup() {
    const baseName = (document.getElementById("base-name")?.value ?? "").trim();
    const rawPath = (document.getElementById("image-path")?.value ?? "").trim();
    // Preserve absolute URLs (CDN); only normalise relative paths
    const isAbsoluteUrl =
      /^https?:\/\//i.test(rawPath) || rawPath.startsWith("//");
    const pathPrefix = rawPath
      ? isAbsoluteUrl
        ? rawPath.replace(/\/*$/, "/")
        : rawPath.replace(/^\/+/, "").replace(/\/*$/, "/")
      : "";
    const fullBase = pathPrefix + baseName;
    const extension = document.getElementById("extension")?.value ?? "webp";
    const widthsRaw = document.getElementById("widths")?.value ?? "";
    const sizes = (document.getElementById("sizes")?.value ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const altText = (document.getElementById("alt-text")?.value ?? "").trim();
    const className = (
      document.getElementById("class-name")?.value ?? ""
    ).trim();
    const loadingMode =
      document.getElementById("loading-mode")?.value ?? "lazy";
    const decodingMode =
      document.getElementById("decoding-mode")?.value ?? "async";
    const fetchPriority =
      document.getElementById("fetch-priority")?.value ?? "";
    const imgWidth = (document.getElementById("img-width")?.value ?? "").trim();
    const imgHeight = (
      document.getElementById("img-height")?.value ?? ""
    ).trim();
    const crossOrigin = document.getElementById("cross-origin")?.value ?? "";
    const tableBody = document.getElementById("candidate-table-body");
    const widths = parseWidths(widthsRaw);

    const lcpWarning = document.getElementById("lcp-warning");
    if (lcpWarning) {
      lcpWarning.hidden = !(loadingMode === "lazy" && fetchPriority !== "high");
    }

    if (!baseName) {
      renderCandidateTable(tableBody, [], []);
      hideSecondaryPanels();
      return {
        markup: "Enter a base filename to generate markup.",
        note: "Base filename is required.",
        canCopy: false,
      };
    }

    if (widths.length < 2) {
      renderCandidateTable(tableBody, widths, []);
      hideSecondaryPanels();
      return {
        markup: "Add at least two valid width candidates.",
        note: "Use at least two widths so the browser can make a responsive selection.",
        canCopy: false,
      };
    }

    if (descriptorMode === "width" && !sizes) {
      renderCandidateTable(tableBody, [], []);
      hideSecondaryPanels();
      return {
        markup: "Enter a sizes attribute value.",
        note: "Sizes is required for width-descriptor srcset.",
        canCopy: false,
      };
    }

    if (!altText) {
      renderCandidateTable(tableBody, [], []);
      hideSecondaryPanels();
      return {
        markup: "Enter alt text for accessibility.",
        note: "Alt text is required.",
        canCopy: false,
      };
    }

    const { src, srcset, candidates } = buildCandidates(
      fullBase,
      extension,
      widths,
    );
    renderCandidateTable(tableBody, widths, candidates);

    // Candidate gap warning: flag adjacent widths less than 15% apart
    const gapWarning = document.getElementById("candidate-gap-warning");
    if (gapWarning) {
      const hasTightGap = widths.some(
        (w, i) => i > 0 && (w - widths[i - 1]) / widths[i - 1] < 0.15,
      );
      gapWarning.hidden = !hasTightGap;
    }

    if (descriptorMode === "width" && sizes) {
      renderDPRCoverage(widths, sizes);
    } else {
      const dprPanel = document.getElementById("dpr-panel");
      if (dprPanel) dprPanel.hidden = true;
    }

    const classAttr = className
      ? `\n  class="${escapeAttribute(className)}"`
      : "";
    const fetchAttr = fetchPriority
      ? `\n  fetchpriority="${escapeAttribute(fetchPriority)}"`
      : "";
    const widthAttr = imgWidth
      ? `\n  width="${escapeAttribute(imgWidth)}"`
      : "";
    const heightAttr = imgHeight
      ? `\n  height="${escapeAttribute(imgHeight)}"`
      : "";
    const crossOriginAttr = crossOrigin
      ? `\n  crossorigin="${escapeAttribute(crossOrigin)}"`
      : "";

    let markup;
    if (outputMode === "picture") {
      markup = buildPictureMarkup({
        baseName: fullBase,
        fallbackExt: extension,
        sizes,
        widths,
        altText,
        loadingMode,
        decodingMode,
        fetchPriority,
        className,
        imgWidth,
        imgHeight,
        crossOrigin,
      });
    } else {
      const lines = [
        "<img",
        `  src="${escapeAttribute(src)}"`,
        `  srcset="${escapeAttribute(srcset)}"`,
      ];
      if (descriptorMode === "width") {
        lines.push(`  sizes="${escapeAttribute(sizes)}"`);
      }
      lines.push(
        `  alt="${escapeAttribute(altText)}"`,
        `  loading="${escapeAttribute(loadingMode)}"`,
        `  decoding="${escapeAttribute(decodingMode)}"${fetchAttr}${widthAttr}${heightAttr}${crossOriginAttr}${classAttr}>`,
      );
      markup = lines.join("\n");
    }

    // Preload snippet: shown when fetchpriority=high and width descriptors are in use
    const preloadSection = document.getElementById("preload-section");
    const preloadOutput = document.getElementById("preload-output");
    const preloadMeta = document.getElementById("preload-meta");
    if (fetchPriority === "high" && descriptorMode === "width") {
      const preloadCrossOrigin = crossOrigin
        ? `\n  crossorigin="${escapeAttribute(crossOrigin)}"`
        : "";
      const preloadSizes = sizes
        ? `\n  imagesizes="${escapeAttribute(sizes)}"`
        : "";
      const preloadMarkup = [
        `<link rel="preload" as="image"`,
        `  href="${escapeAttribute(src)}"`,
        `  imagesrcset="${escapeAttribute(srcset)}"${preloadSizes}`,
        `  fetchpriority="high"${preloadCrossOrigin}>`,
      ].join("\n");
      if (preloadOutput) preloadOutput.textContent = preloadMarkup;
      if (preloadMeta)
        preloadMeta.textContent =
          "Add this tag inside <head> before any render-blocking resources.";
      if (preloadSection) preloadSection.hidden = false;
    } else {
      if (preloadSection) preloadSection.hidden = true;
    }

    const modeLabel = descriptorMode === "density" ? "density" : "width";
    return {
      markup,
      note: `Generated ${widths.length} candidates (${modeLabel} descriptors). Fallback: ${src}.`,
      canCopy: true,
    };
  }

  /**
   * Builds a <picture> tag with avif + webp sources and a fallback <img>.
   * @param {{baseName: string, fallbackExt: string, sizes: string, widths: number[], altText: string, loadingMode: string, decodingMode: string, fetchPriority: string, className: string, imgWidth: string, imgHeight: string, crossOrigin: string}} opts
   * @return {string}
   */
  function buildPictureMarkup({
    baseName,
    fallbackExt,
    sizes,
    widths,
    altText,
    loadingMode,
    decodingMode,
    fetchPriority,
    className,
    imgWidth,
    imgHeight,
    crossOrigin,
  }) {
    const src = `${baseName}-${widths[widths.length - 1]}.${fallbackExt}`;
    const avifSrcset = widths
      .map((w) => `${baseName}-${w}.avif ${w}w`)
      .join(",\n             ");
    const webpSrcset = widths
      .map((w) => `${baseName}-${w}.webp ${w}w`)
      .join(",\n             ");
    const fbSrcset = widths
      .map((w) => `${baseName}-${w}.${fallbackExt} ${w}w`)
      .join(",\n             ");
    const sizesAttr = sizes ? `\n      sizes="${escapeAttribute(sizes)}"` : "";
    const classAttr = className
      ? `\n    class="${escapeAttribute(className)}"`
      : "";
    const fetchAttr = fetchPriority
      ? `\n    fetchpriority="${escapeAttribute(fetchPriority)}"`
      : "";
    const widthAttr = imgWidth
      ? `\n    width="${escapeAttribute(imgWidth)}"`
      : "";
    const heightAttr = imgHeight
      ? `\n    height="${escapeAttribute(imgHeight)}"`
      : "";
    const crossOriginAttr = crossOrigin
      ? `\n    crossorigin="${escapeAttribute(crossOrigin)}"`
      : "";
    return [
      "<picture>",
      `  <source`,
      `    type="image/avif"`,
      `    srcset="${escapeAttribute(avifSrcset)}"${sizesAttr}>`,
      `  <source`,
      `    type="image/webp"`,
      `    srcset="${escapeAttribute(webpSrcset)}"${sizesAttr}>`,
      `  <img`,
      `    src="${escapeAttribute(src)}"`,
      `    srcset="${escapeAttribute(fbSrcset)}"${sizesAttr}`,
      `    alt="${escapeAttribute(altText)}"`,
      `    loading="${escapeAttribute(loadingMode)}"`,
      `    decoding="${escapeAttribute(decodingMode)}"${fetchAttr}${widthAttr}${heightAttr}${crossOriginAttr}${classAttr}>`,
      `</picture>`,
    ].join("\n");
  }

  /**
   * Handles the copy to clipboard action.
   * @param {HTMLButtonElement} btn - The button that triggered the copy.
   * @param {string} text - The text to copy.
   */
  function handleCopy(btn, text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalLabel = btn.getAttribute("aria-label");
        btn.textContent = "Copied!";
        btn.setAttribute("aria-label", "Copied to clipboard");

        setTimeout(() => {
          btn.textContent = "Copy";
          btn.setAttribute("aria-label", originalLabel);
        }, 2000);
      })
      .catch(() => {
        // Clipboard write failed (insecure context or permission denied).
      });
  }

  /**
   * Resizes an image to the target width via Canvas and returns a Blob.
   * @param {HTMLImageElement} img
   * @param {number} targetWidth
   * @param {string} mimeType
   * @param {number} quality
   * @return {Promise<Blob>}
   */
  function resizeImageToBlob(img, targetWidth, mimeType, quality) {
    return new Promise((resolve, reject) => {
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error(`Encoding failed at ${targetWidth}px`));
          }
        },
        mimeType,
        quality,
      );
    });
  }

  /**
   * Updates the export button disabled state based on current form inputs.
   */
  function updateExportButton() {
    const exportBtn = document.getElementById("export-btn");
    const extension = document.getElementById("extension")?.value ?? "webp";
    const isAvif = extension === "avif";
    const avifBlocked = isAvif && !avifSupported;
    const avifNote = document.getElementById("export-avif-note");
    const widths = parseWidths(document.getElementById("widths")?.value ?? "");
    if (avifNote) {
      avifNote.hidden = !avifBlocked;
    }
    if (exportBtn) {
      exportBtn.disabled = !uploadedImage || avifBlocked || widths.length < 2;
    }
  }

  /**
   * Handles a dropped or selected image file and renders the preview.
   * @param {File} file
   */
  function handleImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    // Revoke previous object URL to prevent memory leak
    const existingImg = document.getElementById("preview-img");
    if (existingImg && existingImg.src.startsWith("blob:")) {
      URL.revokeObjectURL(existingImg.src);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      uploadedImage = img;
      sizeEstimates = {};
      const preview = document.getElementById("upload-preview");
      const placeholder = document.getElementById("upload-placeholder");
      const previewImg = document.getElementById("preview-img");
      const previewMeta = document.getElementById("preview-meta");
      const fileInput2 = document.getElementById("image-upload");
      if (previewImg) {
        previewImg.src = url;
        previewImg.alt = `Preview of ${file.name}`;
      }
      if (previewMeta) {
        previewMeta.textContent = `${file.name} | ${img.naturalWidth} x ${img.naturalHeight}px`;
      }
      if (preview) {
        preview.hidden = false;
      }
      if (placeholder) {
        placeholder.hidden = true;
      }
      // Collapse the file input so it no longer covers the clear button
      if (fileInput2)
        fileInput2.style.cssText =
          "width:0;height:0;opacity:0;position:absolute";
      // Show EXIF orientation warning
      const exifNote = document.getElementById("export-exif-note");
      if (exifNote) exifNote.hidden = false;
      updateExportButton();
      doRender();
      estimateCandidateSizes();
    };
    img.src = url;
  }

  /**
   * Clears the uploaded image and resets the upload zone to its initial state.
   */
  function clearImage() {
    uploadedImage = null;
    sizeEstimates = {};
    const preview = document.getElementById("upload-preview");
    const placeholder = document.getElementById("upload-placeholder");
    const previewImg = document.getElementById("preview-img");
    const previewMeta = document.getElementById("preview-meta");
    const fileInput = document.getElementById("image-upload");
    const progressWrap = document.getElementById("export-progress");
    const progressBar = document.getElementById("export-progress-bar");
    const statusEl = document.getElementById("export-status");
    if (previewImg) {
      if (previewImg.src.startsWith("blob:")) {
        URL.revokeObjectURL(previewImg.src);
      }
      previewImg.src = "";
      previewImg.alt = "";
    }
    if (previewMeta) previewMeta.textContent = "";
    if (preview) preview.hidden = true;
    if (placeholder) placeholder.hidden = false;
    if (fileInput) fileInput.value = "";
    if (fileInput) fileInput.style.cssText = ""; // restore full-zone coverage
    if (progressWrap) progressWrap.hidden = true;
    if (progressBar) progressBar.style.width = "0%";
    if (statusEl) statusEl.textContent = "";
    const exifNote = document.getElementById("export-exif-note");
    if (exifNote) exifNote.hidden = true;
    updateExportButton();
    doRender();
  }

  /**
   * Resizes all candidate widths from the source image and downloads a zip.
   */
  async function handleExport() {
    if (!uploadedImage || typeof JSZip === "undefined") return;
    const baseName =
      (document.getElementById("base-name")?.value ?? "").trim() || "image";
    const extension = document.getElementById("extension")?.value ?? "webp";
    const widths = parseWidths(document.getElementById("widths")?.value ?? "");
    const mimeType = CANVAS_MIME_MAP[extension] ?? "image/webp";
    const quality = extension === "png" ? 1 : getQuality();
    const exportBtn = document.getElementById("export-btn");
    const progressWrap = document.getElementById("export-progress");
    const progressBar = document.getElementById("export-progress-bar");
    const statusEl = document.getElementById("export-status");
    if (exportBtn) {
      exportBtn.disabled = true;
    }
    if (progressWrap) {
      progressWrap.hidden = false;
    }
    if (statusEl) {
      statusEl.textContent = "Resizing images\u2026";
    }
    const zip = new JSZip();
    const folder = zip.folder(baseName);
    for (let i = 0; i < widths.length; i += 1) {
      const width = widths[i];
      try {
        const blob = await resizeImageToBlob(
          uploadedImage,
          width,
          mimeType,
          quality,
        );
        folder.file(`${baseName}-${width}.${extension}`, blob);
      } catch {
        // Skip failed size and continue.
      }
      const pct = Math.round(((i + 1) / widths.length) * 90);
      if (progressBar) {
        progressBar.style.width = `${pct}%`;
      }
    }
    const markupResult = generateMarkup();
    if (markupResult.canCopy) {
      zip.file("markup.txt", markupResult.markup);
    }
    try {
      const originalBlob = await resizeImageToBlob(
        uploadedImage,
        uploadedImage.naturalWidth,
        mimeType,
        quality,
      );
      folder.file(`${baseName}.${extension}`, originalBlob);
    } catch {
      // Original-size export failed; continue without it.
    }
    if (statusEl) {
      statusEl.textContent = "Building zip\u2026";
    }
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      if (progressBar) {
        progressBar.style.width = "100%";
      }
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}-srcset.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const count = widths.length;
      if (statusEl) {
        statusEl.textContent = `Done. ${count} resized image${count !== 1 ? "s" : ""} + original exported.`;
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = "Export failed. Please try again.";
      }
    }
    setTimeout(() => {
      if (progressWrap) {
        progressWrap.hidden = true;
      }
      if (progressBar) {
        progressBar.style.width = "0%";
      }
      updateExportButton();
    }, 2500);
  }

  /**
   * Initializes the application.
   */
  function initializeApp() {
    const form = document.getElementById("tool-form");

    setFooterYear();
    initializeTheme();
    detectAvifSupport().then((supported) => {
      avifSupported = supported;
      updateExportButton();
    });

    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

    // Sizes reset button
    const resetSizesBtn = document.getElementById("reset-sizes");
    const sizesTextarea = document.getElementById("sizes");
    if (resetSizesBtn && sizesTextarea) {
      resetSizesBtn.addEventListener("click", () => {
        // Use active preset sizes if one is selected, otherwise generic default
        sizesTextarea.value =
          (activePreset && PRESETS[activePreset]?.sizes) || DEFAULT_SIZES;
        doRender();
        saveSettings();
      });
    }

    // Output mode toggle
    const modeImgBtn = document.getElementById("mode-img");
    const modePicBtn = document.getElementById("mode-picture");
    if (modeImgBtn) {
      modeImgBtn.addEventListener("click", () => {
        setOutputMode("img");
        saveSettings();
        doRender();
      });
    }
    if (modePicBtn) {
      modePicBtn.addEventListener("click", () => {
        setOutputMode("picture");
        saveSettings();
        doRender();
      });
    }

    // Descriptor mode toggle
    const descWidthBtn = document.getElementById("desc-width");
    const descDensityBtn = document.getElementById("desc-density");
    if (descWidthBtn) {
      descWidthBtn.addEventListener("click", () => {
        setDescriptorMode("width");
        saveSettings();
        doRender();
      });
    }
    if (descDensityBtn) {
      descDensityBtn.addEventListener("click", () => {
        setDescriptorMode("density");
        saveSettings();
        doRender();
      });
    }

    // Preset width buttons
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;
        activePreset = btn.dataset.preset;
        const widthsInput = document.getElementById("widths");
        const sizesInput = document.getElementById("sizes");
        if (widthsInput) widthsInput.value = preset.widths.join(", ");
        if (sizesInput) sizesInput.value = preset.sizes;
        sizeEstimates = {};
        doRender();
        updateExportButton();
        if (uploadedImage) estimateCandidateSizes();
        saveSettings();
      });
    });

    // Quality slider
    const qualitySlider = document.getElementById("quality-slider");
    if (qualitySlider) {
      qualitySlider.addEventListener("input", () => {
        updateQualityLabel();
        sizeEstimates = {};
        if (uploadedImage) estimateCandidateSizes();
        saveSettings();
      });
    }

    loadSettings();

    if (form) {
      form.addEventListener("input", (e) => {
        // Sync alt text from base-name unless the user has touched it
        if (e.target && e.target.id === "base-name" && !altTextTouched) {
          const altInput = document.getElementById("alt-text");
          if (altInput) altInput.value = e.target.value.trim();
        }
        if (e.target && e.target.id === "alt-text") {
          altTextTouched = true;
          const resyncBtn = document.getElementById("resync-alt");
          if (resyncBtn) resyncBtn.hidden = false;
        }
        doRender();
        saveSettings();
      });
    }

    doRender();

    const copyBtn = document.getElementById("copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        if (copyBtn.disabled) return;
        const outputEl = document.getElementById("tool-output");
        if (outputEl) handleCopy(copyBtn, outputEl.textContent);
      });
    }

    // Preload copy button
    const copyPreloadBtn = document.getElementById("copy-preload-btn");
    if (copyPreloadBtn) {
      copyPreloadBtn.addEventListener("click", () => {
        const preloadOutput = document.getElementById("preload-output");
        if (preloadOutput)
          handleCopy(copyPreloadBtn, preloadOutput.textContent);
      });
    }

    // Alt text re-sync button
    const resyncAltBtn = document.getElementById("resync-alt");
    if (resyncAltBtn) {
      resyncAltBtn.addEventListener("click", () => {
        altTextTouched = false;
        const baseNameEl = document.getElementById("base-name");
        const altInput = document.getElementById("alt-text");
        if (baseNameEl && altInput) altInput.value = baseNameEl.value.trim();
        resyncAltBtn.hidden = true;
        doRender();
        saveSettings();
      });
    }

    // Export controls
    const uploadZone = document.getElementById("upload-zone");
    const fileInput = document.getElementById("image-upload");
    const exportBtn = document.getElementById("export-btn");
    const extensionSelect = document.getElementById("extension");
    const widthsInput = document.getElementById("widths");

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files?.[0]) handleImageFile(fileInput.files[0]);
      });
    }
    const clearBtn = document.getElementById("clear-image");
    if (clearBtn) clearBtn.addEventListener("click", clearImage);
    if (uploadZone) {
      uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("upload-zone--drag-over");
      });
      uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("upload-zone--drag-over");
      });
      uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("upload-zone--drag-over");
        const file = e.dataTransfer?.files?.[0];
        if (file) handleImageFile(file);
      });
    }
    if (exportBtn) exportBtn.addEventListener("click", handleExport);
    if (extensionSelect) {
      extensionSelect.addEventListener("change", () => {
        updateExportButton();
        sizeEstimates = {};
        if (uploadedImage) estimateCandidateSizes();
      });
    }
    if (widthsInput) {
      widthsInput.addEventListener("input", () => {
        updateExportButton();
        sizeEstimates = {};
        if (uploadedImage) estimateCandidateSizes();
      });
    }
  }

  if (document.readyState === "complete") {
    initializeApp();
  } else {
    window.addEventListener("load", initializeApp, { once: true });
  }
})();
