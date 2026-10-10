const STORAGE_KEY = "kandagrade-assessments-v1";
const app = document.querySelector("#app");
const photoInput = document.querySelector("#photo-input");
const toastRegion = document.querySelector("#toast-region");
const routeNames = ["live", "analytics", "standards", "history"];
const gradeDetails = {
  A: { label: "Premium", price: "₹2,400–₹2,800 / qtl", size: "Large" },
  B: { label: "Market", price: "₹1,800–₹2,300 / qtl", size: "Medium" },
  C: { label: "Processing", price: "₹1,000–₹1,600 / qtl", size: "Small" },
  Reject: { label: "Reject", price: "Below ₹1,000 / qtl", size: "Mixed" },
};
const sampleCases = {
  premium: { name: "Premium red", score: 96, defects: [], color: "#a8322b" },
  market: { name: "Market lot", score: 79, defects: ["Minor skin marks"], color: "#bc573b" },
  defective: { name: "Defective bulb", score: 43, defects: ["Dark blemishes", "Soft / damaged area"], color: "#52352d" },
};

let cameraStream = null;
let facingMode = "environment";
let selectedPhoto = null;
let selectedImageUrl = "";
let currentResult = null;
let toastTimer = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function readBatches() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError("Saved assessment data is not a list.");
    return parsed.filter((item) => item && typeof item.id === "string" && typeof item.grade === "string");
  } catch (error) {
    console.error("Unable to read saved assessments.", error);
    showToast("Saved assessment data could not be read. Clear this site's stored data if the issue persists.", "error");
    return [];
  }
}

function writeBatches(batches) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

function showToast(message, tone = "") {
  window.clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast ${tone}">${escapeHtml(message)}</div>`;
  toastTimer = window.setTimeout(() => { toastRegion.replaceChildren(); }, 4300);
}

function icon(name) {
  const paths = {
    camera: '<path d="M9 4 7.5 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4H9Zm3 4.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
    upload: '<path d="M12 3 5.5 9.5l1.4 1.4L11 7v9h2V7l4.1 3.9 1.4-1.4L12 3ZM4 18h16v2H4v-2Z"/>',
    switch: '<path d="M7 7h12l-2.5-2.5L18 3l5 5-5 5-1.5-1.5L19 9H7V7ZM17 17H5l2.5 2.5L6 21l-5-5 5-5 1.5 1.5L5 15h12v2Z"/>',
    download: '<path d="M11 3h2v9.2l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4 3.3 3.3V3ZM4 18h16v2H4v-2Z"/>',
    arrow: '<path d="M5 12h13.2l-4.6-4.6L15 6l6 6-6 6-1.4-1.4 4.6-4.6H5v-2Z"/>',
    trash: '<path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-3 6h14l-1 12H6L5 9Zm3 2 .6 8h1.8l-.5-8H8Zm5 0-.5 8h1.8l.6-8H13Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function pageHeading(title, description, eyebrow = "") {
  return `<header class="page-heading"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h1>${title}</h1><p>${description}</p></div></header>`;
}

function getRoute() {
  const hash = window.location.hash.slice(1);
  const route = hash.split("?")[0].replace(/^\//, "");
  return routeNames.includes(route) ? route : "live";
}

function navigate() {
  const route = getRoute();
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  currentResult = null;
  selectedPhoto = null;
  selectedImageUrl = "";
  if (route !== "live") stopCamera();
  if (route === "live") renderLive();
  if (route === "analytics") renderAnalytics();
  if (route === "standards") renderStandards();
  if (route === "history") renderHistory();
  app.focus({ preventScroll: true });
  if (route === "live" && window.location.hash.includes("camera=1")) {
    window.setTimeout(startCamera, 0);
    window.history.replaceState(null, "", "#/live");
  }
}

function renderLive() {
  app.innerHTML = `
    ${pageHeading("Live Inspection", "Capture an onion or choose a reference sample to get an on-device quality estimate.", "Quality assessment")}
    <div class="grid inspection-grid">
      <div class="stack">
        <section class="panel">
          <div class="panel-header"><div><h2>Live Inspection Feed</h2><p>Centre one onion inside the reticle for a closer visual check.</p></div><span id="camera-status" class="status"><i class="status-dot"></i> CAMERA OFF</span></div>
          <div class="panel-body">
            <div class="camera-stage" id="camera-stage">
              <video id="camera-video" autoplay muted playsinline></video>
              <img id="preview-image" alt="Selected onion for inspection" />
              <div class="camera-placeholder"><span class="camera-icon">${icon("camera")}</span><strong>Camera is off</strong><p>Start your device camera, upload a photo, or analyze a sample onion.</p></div>
              <div class="reticle" aria-hidden="true"></div>
              <div class="stage-tools"><span class="status"><i class="status-dot"></i> ONE ONION</span><button id="switch-camera" class="icon-button button-quiet" type="button" aria-label="Switch between front and rear camera" title="Switch camera">${icon("switch")}</button></div>
            </div>
            <div class="camera-controls">
              <button id="start-camera" class="button button-primary" type="button">${icon("camera")} Start Camera</button>
              <button id="capture-grade" class="button button-secondary" type="button" disabled>${icon("camera")} Capture &amp; Grade</button>
              <button class="button button-secondary file-button" type="button" id="upload-trigger">${icon("upload")} Upload a photo</button>
            </div>
            <div class="reference-block">
              <div class="reference-title">Or grade a reference sample:</div>
              <div class="sample-row">
                <button class="sample-card" type="button" data-sample="premium"><span class="sample-visual" aria-hidden="true">🧅</span><strong>Premium red</strong><small>Healthy reference</small></button>
                <button class="sample-card" type="button" data-sample="market"><span class="sample-visual" aria-hidden="true">🧅</span><strong>Market lot</strong><small>Light skin marks</small></button>
                <button class="sample-card" type="button" data-sample="defective"><span class="sample-visual" aria-hidden="true">🧅</span><strong>Defective bulb</strong><small>Visible blemishes</small></button>
              </div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>Batch details</h2><p>These details are attached to each assessment you save.</p></div></div>
          <div class="panel-body field-grid">
            <label class="field">Variety<select id="variety"><option>Unspecified</option><option>Red onion</option><option>White onion</option><option>Yellow onion</option><option>Other</option></select></label>
            <label class="field">Lot ID<input id="lot-id" type="text" maxlength="60" placeholder="LOT-2026-041" /></label>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>How grading works</h2><p>Two inspection layers are combined into one indicative grade.</p></div></div>
          <div class="panel-body how-list">
            <div class="how-step"><span class="step-number">01</span><div><strong>On-device pixel scan</strong><p>Checks sampled color, dark blemish share and color uniformity in your image.</p></div></div>
            <div class="how-step"><span class="step-number">02</span><div><strong>Visual defect indicators</strong><p>Highlights dark patches and skin variation. This demo does not connect to an AI vision service.</p></div></div>
            <div class="how-step"><span class="step-number">03</span><div><strong>Grade and market band</strong><p>Combines the score with indicative size and local price ranges. Save records stay in this browser.</p></div></div>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-header"><div><h2>Grading HUD</h2><p>Your image score, grade stamp and diagnostic indicators.</p></div></div>
        <div id="verdict" class="verdict-empty"><span class="camera-icon">${icon("camera")}</span><strong>Awaiting a capture</strong><p>Start the camera, upload an onion, or choose a reference sample to generate an assessment.</p></div>
      </section>
    </div>`;
  document.querySelector("#start-camera").addEventListener("click", startCamera);
  document.querySelector("#capture-grade").addEventListener("click", captureAndGrade);
  document.querySelector("#switch-camera").addEventListener("click", switchCamera);
  document.querySelector("#upload-trigger").addEventListener("click", () => photoInput.click());
  document.querySelectorAll("[data-sample]").forEach((button) => {
    button.addEventListener("click", () => analyzeSample(button.dataset.sample));
  });
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera access is unavailable. Use a secure connection (HTTPS or localhost), or upload a photo instead.", "error");
    return;
  }
  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const video = document.querySelector("#camera-video");
    if (!video) { stopCamera(); return; }
    video.srcObject = cameraStream;
    await video.play();
    document.querySelector("#camera-stage")?.classList.add("has-camera");
    document.querySelector("#camera-status")?.classList.add("is-on");
    const status = document.querySelector("#camera-status");
    if (status) status.lastChild.textContent = " CAMERA ON";
    document.querySelector("#capture-grade").disabled = false;
    showToast("Camera ready. Centre one onion, then capture it.", "success");
  } catch (error) {
    console.error("Unable to start the camera.", error);
    const message = error.name === "NotAllowedError"
      ? "Camera permission was denied. Allow access in your browser, or upload a photo."
      : error.name === "NotFoundError"
        ? "No camera was found on this device. Upload a photo to continue."
        : "The camera could not be started. Check that another app is not using it.";
    showToast(message, "error");
  }
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}

async function switchCamera() {
  facingMode = facingMode === "environment" ? "user" : "environment";
  if (cameraStream) await startCamera();
}

function captureAndGrade() {
  const video = document.querySelector("#camera-video");
  if (!video || !video.videoWidth || !video.videoHeight) {
    showToast("Wait for the camera preview to load, then try again.", "error");
    return;
  }
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 800 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("The captured frame could not be processed. Try again or upload a photo.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      selectedPhoto = new Image();
      selectedPhoto.onload = () => {
        selectedImageUrl = String(reader.result);
        updatePreview(selectedImageUrl);
        analyzePhoto();
      };
      selectedPhoto.onerror = () => showToast("The captured image could not be loaded.", "error");
      selectedPhoto.src = String(reader.result);
    };
    reader.onerror = () => showToast("The captured image could not be read.", "error");
    reader.readAsDataURL(blob);
  }, "image/jpeg", 0.78);
}

function updatePreview(src) {
  const image = document.querySelector("#preview-image");
  const stage = document.querySelector("#camera-stage");
  if (!image || !stage) return;
  image.src = src;
  stage.classList.remove("has-camera");
  stage.classList.add("has-photo");
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Choose a valid image file.", "error");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showToast("That photo is larger than 12 MB. Choose a smaller image.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      selectedPhoto = image;
      selectedImageUrl = compressImage(image);
      updatePreview(selectedImageUrl);
      analyzePhoto();
    };
    image.onerror = () => showToast("The selected photo could not be decoded. Try another image.", "error");
    image.src = String(reader.result);
  };
  reader.onerror = () => showToast("The selected photo could not be read.", "error");
  reader.readAsDataURL(file);
});

function compressImage(image) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.68);
}

function analyzePixels(image) {
  const canvas = document.createElement("canvas");
  const side = 96;
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, side, side);
  const { data } = context.getImageData(0, 0, side, side);
  let count = 0;
  let dark = 0;
  let red = 0;
  let brightnessSum = 0;
  let brightnessSquareSum = 0;
  for (let y = 12; y < side - 12; y += 2) {
    for (let x = 12; x < side - 12; x += 2) {
      const offset = (y * side + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      count += 1;
      if (brightness < 65) dark += 1;
      if (r > g * 1.18 && r > b * 1.18) red += 1;
      brightnessSum += brightness;
      brightnessSquareSum += brightness * brightness;
    }
  }
  const darkShare = count ? dark / count : 0;
  const redShare = count ? red / count : 0;
  const mean = brightnessSum / Math.max(1, count);
  const variance = Math.max(0, brightnessSquareSum / Math.max(1, count) - mean * mean);
  const uniformity = Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(variance) * 0.55)));
  const score = Math.max(5, Math.min(99, Math.round(96 - darkShare * 280 - (100 - uniformity) * 0.13)));
  return { score, darkShare, redShare };
}

function assess(score, defects) {
  const grade = score >= 88 ? "A" : score >= 72 ? "B" : score >= 55 ? "C" : "Reject";
  const details = gradeDetails[grade];
  return { grade, score, defects, ...details };
}

function analyzeSample(key) {
  const sample = sampleCases[key];
  if (!sample) return;
  selectedPhoto = null;
  selectedImageUrl = "";
  document.querySelector("#camera-stage")?.classList.remove("has-camera", "has-photo");
  const result = assess(sample.score, sample.defects);
  result.source = "Reference sample";
  result.image = "";
  result.sampleName = sample.name;
  result.saved = false;
  completeAssessment(result);
}

function analyzePhoto() {
  if (!selectedPhoto) {
    showToast("Choose an image before running the assessment.", "error");
    return;
  }
  let metrics;
  try {
    metrics = analyzePixels(selectedPhoto);
  } catch (error) {
    console.error("Image pixel analysis failed.", error);
    showToast("This photo could not be analyzed. Try a different image.", "error");
    return;
  }
  const defects = [];
  if (metrics.darkShare > 0.055) defects.push("Dark blemishes");
  if (metrics.darkShare > 0.14) defects.push("Soft / damaged area");
  if (metrics.redShare < 0.08) defects.push("Uneven skin color");
  if (metrics.score < 80 && defects.length === 0) defects.push("Visible skin variation");
  const result = assess(metrics.score, defects);
  result.source = "Image pixel scan";
  result.image = selectedImageUrl;
  result.darkShare = metrics.darkShare;
  result.redShare = metrics.redShare;
  result.saved = false;
  completeAssessment(result);
}

function completeAssessment(result) {
  result.id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  result.createdAt = new Date().toISOString();
  result.variety = document.querySelector("#variety")?.value || "Unspecified";
  result.lotId = document.querySelector("#lot-id")?.value.trim() || "Unassigned";
  currentResult = result;
  saveAssessment(result);
  renderVerdict();
}

function saveAssessment(result) {
  try {
    const batches = readBatches();
    writeBatches([result, ...batches].slice(0, 250));
    result.saved = true;
    showToast("Assessment saved to this browser's batch log.", "success");
  } catch (error) {
    console.error("Unable to save assessment.", error);
    result.saved = false;
    showToast("The grade is ready, but this browser could not save it. Check available site storage and try saving again.", "error");
  }
}

function renderVerdict() {
  const target = document.querySelector("#verdict");
  if (!target || !currentResult) return;
  const result = currentResult;
  const gradeClass = result.grade === "A" ? "" : result.grade === "B" ? "grade-b" : result.grade === "C" ? "grade-c" : "grade-reject";
  const defectTags = result.defects.length
    ? result.defects.map((defect) => `<span class="defect-tag alert">${escapeHtml(defect)}</span>`).join("")
    : '<span class="defect-tag">No major defects indicated</span>';
  target.className = "panel-body result-card";
  target.innerHTML = `
    <div class="grade-row"><div class="grade-stamp ${gradeClass}">${result.grade === "Reject" ? "R" : result.grade}</div><div><h2>${escapeHtml(result.label)} grade</h2><p>${escapeHtml(result.sampleName || result.source)} · ${escapeHtml(result.variety)}</p></div></div>
    <div><div class="score-line"><strong class="score-value">${result.score}</strong><span class="score-denom">/ 100 quality score</span></div><div class="score-track" role="progressbar" aria-valuenow="${result.score}" aria-valuemin="0" aria-valuemax="100"><div class="score-fill" style="width:${result.score}%"></div></div></div>
    <div class="result-meta"><div class="meta-tile"><span>Size class</span><strong>${escapeHtml(result.size)}</strong></div><div class="meta-tile"><span>Indicative mandi band</span><strong>${escapeHtml(result.price)}</strong></div></div>
    <div><div class="panel-kicker">Detected indicators</div><div class="defect-list" style="margin-top:9px">${defectTags}</div></div>
    <div class="source-note">Indicative browser-only estimate based on image pixels and sample presets—not a certified inspection or connected AI vision result. Mandi prices are illustrative and should be checked against current local market rates.</div>
    <div class="result-actions"><button id="save-again" class="button button-secondary" type="button" ${result.saved ? "disabled" : ""}>${result.saved ? "Saved to batch log" : "Save assessment"}</button><a class="button button-quiet" href="#/history">View batches ${icon("arrow")}</a></div>`;
  document.querySelector("#save-again")?.addEventListener("click", () => {
    if (!currentResult || currentResult.saved) return;
    saveAssessment(currentResult);
    renderVerdict();
  });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderAnalytics() {
  const batches = readBatches();
  const total = batches.length;
  const average = total ? Math.round(batches.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / total) : 0;
  const grades = ["A", "B", "C", "Reject"];
  const gradeCounts = Object.fromEntries(grades.map((grade) => [grade, batches.filter((item) => item.grade === grade).length]));
  const defectCounts = {};
  batches.forEach((item) => (item.defects || []).forEach((defect) => { defectCounts[defect] = (defectCounts[defect] || 0) + 1; }));
  const max = Math.max(1, ...grades.map((grade) => gradeCounts[grade]));
  const bars = grades.map((grade) => `<div class="chart-col"><span class="chart-count">${gradeCounts[grade]}</span><div class="chart-bar" style="height:${Math.max(3, Math.round(130 * gradeCounts[grade] / max))}px"></div><span class="chart-label">Grade ${grade === "Reject" ? "R" : grade}</span></div>`).join("");
  const legend = grades.map((grade, index) => `<div class="legend-row"><span class="legend-label"><i class="legend-dot" style="background:${["#4bd1a2","#f5c45d","#ff9e67","#ff7778"][index]}"></i>${grade === "Reject" ? "Reject" : `Grade ${grade}`}</span><span class="legend-count">${gradeCounts[grade]}</span></div>`).join("");
  const topDefects = Object.entries(defectCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  app.innerHTML = `
    ${pageHeading("Lot Analytics", "A quick quality overview of assessments saved in this browser.", "Batch insights")}
    <div class="grid stats-grid">
      <article class="panel stat-card"><div class="stat-label">Total assessments</div><strong>${total}</strong><small>Saved in this browser</small></article>
      <article class="panel stat-card"><div class="stat-label">Average quality score</div><strong>${total ? `${average}<span style="font-size:13px;color:var(--muted)"> / 100</span>` : "—"}</strong><small>Across all saved grades</small></article>
      <article class="panel stat-card"><div class="stat-label">Premium grade share</div><strong>${total ? `${Math.round(gradeCounts.A * 100 / total)}%` : "—"}</strong><small>${gradeCounts.A} Grade A assessments</small></article>
      <article class="panel stat-card"><div class="stat-label">Most recent</div><strong style="font-size:16px">${total ? escapeHtml(formatDate(batches[0].createdAt)) : "—"}</strong><small>${total ? escapeHtml(batches[0].lotId) : "No batches yet"}</small></article>
    </div>
    <div class="grid analytics-grid">
      <section class="panel"><div class="panel-header"><div><h2>Grade distribution</h2><p>Assessment count by quality grade.</p></div></div><div class="panel-body"><div class="chart">${bars}</div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Grade mix</h2><p>Share of each grading outcome.</p></div></div><div class="panel-body"><div class="legend-list">${legend}</div><div style="height:1px;background:var(--line);margin:17px 0"></div><div class="panel-kicker">Common defect indicators</div>${topDefects.length ? `<div class="legend-list" style="margin-top:13px">${topDefects.map(([name, count]) => `<div class="legend-row"><span>${escapeHtml(name)}</span><span class="legend-count">${count}</span></div>`).join("")}</div>` : '<p class="hint" style="margin:11px 0 0">Defect indicators will appear as assessments are saved.</p>'}</div></section>
    </div>
    <p class="hint" style="margin-top:16px">Analytics are calculated from the records stored in this browser only.</p>`;
}

function renderStandards() {
  const standards = [
    { grade: "A", label: "Premium", band: "88–100", desc: "Well-cured, firm bulbs with intact dry skin and no significant visible defects.", limits: [["Visible defects", "≤ 2%"], ["Suggested size", "Large / uniform"], ["Price guide", "₹2,400–₹2,800 / qtl"]] },
    { grade: "B", label: "Market", band: "72–87", desc: "Sound marketable bulbs; small surface marks or slight variation may be present.", limits: [["Visible defects", "≤ 5%"], ["Suggested size", "Medium"], ["Price guide", "₹1,800–₹2,300 / qtl"]] },
    { grade: "C", label: "Processing", band: "55–71", desc: "Usable bulbs with noticeable skin variation or minor damage, suited to processing.", limits: [["Visible defects", "≤ 10%"], ["Suggested size", "Small / mixed"], ["Price guide", "₹1,000–₹1,600 / qtl"]] },
    { grade: "Reject", label: "Reject", band: "Below 55", desc: "Severe blemishes, softness or damage may make these bulbs unsuitable for sale.", limits: [["Visible defects", "> 10%"], ["Suggested size", "Mixed"], ["Price guide", "Below ₹1,000 / qtl"]] },
  ];
  app.innerHTML = `
    ${pageHeading("Grading Standards", "Reference score bands and visual quality indicators used by this demo.", "Quality reference")}
    <div class="grid standards-grid">${standards.map((item) => `<article class="panel standard-card"><div class="standard-top"><span class="standard-grade ${item.grade === "B" ? "grade-b" : item.grade === "C" ? "grade-c" : item.grade === "Reject" ? "grade-reject" : ""}">${item.grade === "Reject" ? "R" : item.grade}</span><div><h2>${item.label}</h2><p>Score ${item.band}</p></div></div><p>${item.desc}</p>${item.limits.map(([label, value]) => `<div class="standard-line"><span>${label}</span><strong>${value}</strong></div>`).join("")}</article>`).join("")}</div>
    <div class="standards-note"><strong>Important:</strong> These score bands and mandi price ranges are illustrative demo references, not official agricultural standards or live market quotations. The browser-only photo scan is not a substitute for a trained grader or laboratory inspection.</div>`;
}

function gradeClass(grade) {
  return grade === "A" ? "" : grade === "B" ? "grade-b" : grade === "C" ? "grade-c" : "grade-reject";
}

function renderHistory() {
  const batches = readBatches();
  app.innerHTML = `
    <div class="page-heading"><div><div class="eyebrow">Assessment log</div><h1>Saved Batches</h1><p>Every graded capture with its photo, stamp and defect indicators — ${batches.length} ${batches.length === 1 ? "record" : "records"}.</p></div><div class="toolbar"><button id="export-csv" class="button button-secondary" type="button" ${batches.length ? "" : "disabled"}>${icon("download")} Export CSV</button>${batches.length ? '<button id="clear-batches" class="button button-danger" type="button">Clear all</button>' : ""}</div></div>
    ${batches.length ? `<div class="panel"><div class="panel-header"><div><h2>Assessment history</h2><p>Newest records appear first. Records remain on this device.</p></div></div><div class="panel-body history-list">${batches.map((item) => `<article class="history-card"><div class="history-thumb">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : "🧅"}</div><div class="history-main"><div class="history-title"><span class="standard-grade ${gradeClass(item.grade)}">${item.grade === "Reject" ? "R" : escapeHtml(item.grade)}</span><strong>${escapeHtml(item.sampleName || item.label)} · ${escapeHtml(item.variety)}</strong></div><div class="history-sub">${escapeHtml(item.lotId)} · ${escapeHtml(formatDate(item.createdAt))}</div><div class="history-tags">${(item.defects?.length ? item.defects : ["No major defects"]).map((defect) => `<span class="chip">${escapeHtml(defect)}</span>`).join("")}<span class="chip">${escapeHtml(item.price)}</span></div></div><div class="history-score"><strong>${Number(item.score) || 0}</strong><small>/ 100</small><button class="icon-button button-quiet remove-record" type="button" data-delete="${escapeHtml(item.id)}" aria-label="Delete assessment from ${escapeHtml(item.lotId)}" title="Delete assessment">${icon("trash")}</button></div></article>`).join("")}</div></div>` : `<section class="panel empty-state"><span class="camera-icon">${icon("camera")}</span><h2>No assessments saved yet</h2><p>Capture an onion from the Live Inspection tab or try a reference sample, and it will appear here.</p><a class="button button-primary" href="#/live">Go to Live Inspection ${icon("arrow")}</a></section>`}`;
  document.querySelector("#export-csv")?.addEventListener("click", exportCsv);
  document.querySelector("#clear-batches")?.addEventListener("click", clearBatches);
  document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteBatch(button.dataset.delete)));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
  const batches = readBatches();
  if (!batches.length) {
    showToast("There are no saved assessments to export.");
    return;
  }
  const columns = ["Date", "Lot ID", "Variety", "Grade", "Label", "Score", "Size", "Indicative price", "Defect indicators", "Source"];
  const rows = batches.map((item) => [
    formatDate(item.createdAt), item.lotId, item.variety, item.grade, item.label, item.score,
    item.size, item.price, (item.defects || []).join("; "), item.source,
  ]);
  const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kandagrade-batches-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function deleteBatch(id) {
  const batch = readBatches();
  try {
    writeBatches(batch.filter((item) => item.id !== id));
    showToast("Assessment deleted.", "success");
    renderHistory();
  } catch (error) {
    console.error("Unable to delete assessment.", error);
    showToast("This assessment could not be deleted from browser storage.", "error");
  }
}

function clearBatches() {
  if (!window.confirm("Delete all saved assessments from this browser? This cannot be undone.")) return;
  try {
    writeBatches([]);
    showToast("All saved assessments were cleared.", "success");
    renderHistory();
  } catch (error) {
    console.error("Unable to clear saved assessments.", error);
    showToast("Saved assessments could not be cleared from browser storage.", "error");
  }
}

window.addEventListener("hashchange", navigate);
window.addEventListener("pagehide", stopCamera);
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  if (getRoute() === "history") renderHistory();
  if (getRoute() === "analytics") renderAnalytics();
});

if (!window.location.hash) window.history.replaceState(null, "", "#/live");
navigate();
