
import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { downloadOfflineModels, translateOffline } from "./offlineTranslate";
import { evaluateTranslation } from "./translationMetrics";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const DEFAULT_LANGUAGES = {
  English: "eng_Latn",
  Kannada: "kan_Knda",
  Hindi: "hin_Deva",
  Tamil: "tam_Taml",
  Telugu: "tel_Telu",
};

// Offline Android supports Japanese now; the online API still lists five languages.
const OFFLINE_LANGUAGES = { ...DEFAULT_LANGUAGES, Japanese: "jpn_Jpan" };
const IS_NATIVE_APP = Capacitor.isNativePlatform();

// Keep the existing key so previous translation history isn't lost.
const HISTORY_KEY = "linguabridge_translation_history";
const EVALUATION_KEY = "translayter_evaluations_v1";

export default function App() {
  const [languages, setLanguages] = useState(DEFAULT_LANGUAGES);
  const [translationMode, setTranslationMode] = useState(
    IS_NATIVE_APP ? "offline" : "online"
  );
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("English");
  const [targetLanguage, setTargetLanguage] = useState("Kannada");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiOnline, setApiOnline] = useState(false);
  const [modelInfo, setModelInfo] = useState(null);
  const [processingTime, setProcessingTime] = useState(null);
  const [activeTab, setActiveTab] = useState("translator");
  const [evalOriginal, setEvalOriginal] = useState("");
  const [evalCandidate, setEvalCandidate] = useState("");
  const [evalReference, setEvalReference] = useState("");
  const [evalPair, setEvalPair] = useState("");
  const [evalEngine, setEvalEngine] = useState("");
  const [evalMessage, setEvalMessage] = useState("");
  const [evaluationRows, setEvaluationRows] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(EVALUATION_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const isOfflineMode = IS_NATIVE_APP && translationMode === "offline";
  const availableLanguages = isOfflineMode ? OFFLINE_LANGUAGES : languages;

  useEffect(() => {
    // Do not contact FastAPI while in offline mode.
    if (translationMode === "offline") {
      setApiOnline(false);
      return;
    }
    async function initialize() {
      try {
        const [languagesResponse, modelResponse] = await Promise.all([
          fetch(`${API_URL}/api/languages`),
          fetch(`${API_URL}/api/model-info`),
        ]);

        if (!languagesResponse.ok || !modelResponse.ok) {
          throw new Error("Backend is unavailable.");
        }

        const languageData = await languagesResponse.json();
        const modelData = await modelResponse.json();

        setLanguages(languageData.languages);
        setModelInfo(modelData);
        setApiOnline(true);
      } catch {
        setApiOnline(false);
      }
    }

    initialize();
  }, [translationMode]);

  useEffect(() => {
    // Japanese is only selectable in offline mode until FastAPI adds it.
    if (!availableLanguages[sourceLanguage]) setSourceLanguage("English");
    if (!availableLanguages[targetLanguage]) setTargetLanguage("Kannada");
  }, [translationMode, languages, sourceLanguage, targetLanguage]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(EVALUATION_KEY, JSON.stringify(evaluationRows));
  }, [evaluationRows]);

  const currentScores = useMemo(
    () => evaluateTranslation(evalCandidate, evalReference),
    [evalCandidate, evalReference]
  );
  const averageBleu = evaluationRows.length
    ? (evaluationRows.reduce((total, item) => total + item.bleu, 0) / evaluationRows.length).toFixed(1)
    : null;
  const averageChrF = evaluationRows.length
    ? (evaluationRows.reduce((total, item) => total + item.chrf, 0) / evaluationRows.length).toFixed(1)
    : null;

  const characterCount = inputText.length;
  const wordCount = inputText.trim()
    ? inputText.trim().split(/\s+/).length
    : 0;

  async function handleDownloadModels() {
    setDownloadStatus("");
    if (sourceLanguage === targetLanguage) {
      setDownloadStatus("Choose two different languages in the Translator tab first.");
      return;
    }
    setDownloading(true);
    setDownloadStatus("Downloading language models. Keep Wi-Fi connected...");
    try {
      await downloadOfflineModels(
        OFFLINE_LANGUAGES[sourceLanguage],
        OFFLINE_LANGUAGES[targetLanguage]
      );
      setDownloadStatus(
        `${sourceLanguage} and ${targetLanguage} are ready for offline translation.`
      );
    } catch (err) {
      setDownloadStatus(err?.message || "Model download failed. Check your internet connection.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleTranslate() {
    const text = inputText.trim();

    if (!text) {
      setError("Please enter some text to translate.");
      return;
    }

    if (sourceLanguage === targetLanguage) {
      setError("Please select two different languages.");
      return;
    }

    setLoading(true);
    setError("");
    setOutputText("");
    setProcessingTime(null);

    try {
      let translatedText;
      let duration;
      let model;

      if (isOfflineMode) {
        const startedAt = performance.now();
        translatedText = await translateOffline(
          text,
          OFFLINE_LANGUAGES[sourceLanguage],
          OFFLINE_LANGUAGES[targetLanguage]
        );
        duration = Number(((performance.now() - startedAt) / 1000).toFixed(2));
        model = "Google ML Kit (on-device)";
      } else {
        const response = await fetch(`${API_URL}/api/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            source_language: sourceLanguage,
            target_language: targetLanguage,
          }),
        });

        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error("The backend returned an invalid response.");
        }

        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Translation failed."
          );
        }

        translatedText = data.translated_text;
        duration = data.processing_time_seconds;
        model = data.model;
        setApiOnline(true);
      }

      setOutputText(translatedText);
      setProcessingTime(duration);

      const entry = {
        id: crypto.randomUUID(),
        original: text,
        translated: translatedText,
        source: sourceLanguage,
        target: targetLanguage,
        model,
        time: duration,
        date: new Date().toLocaleString(),
      };
      setHistory((previous) => [entry, ...previous].slice(0, 30));
    } catch (err) {
      setError(err?.message || "Something went wrong.");
      if (!isOfflineMode) setApiOnline(false);
    } finally {
      setLoading(false);
    }
  }

  function swapLanguages() {
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    setInputText(outputText || inputText);
    setOutputText("");
    setProcessingTime(null);
    setError("");
  }

  async function copyText(text) {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Copy failed. Please select and copy the text manually.");
    }
  }

  function clearAll() {
    setInputText("");
    setOutputText("");
    setError("");
    setProcessingTime(null);
  }

  function loadHistory(item) {
    setInputText(item.original);
    setOutputText(item.translated);
    setSourceLanguage(item.source);
    setTargetLanguage(item.target);
    setProcessingTime(item.time);
    setActiveTab("translator");
    setError("");
  }

  function deleteHistory(id) {
    setHistory((previous) => previous.filter((item) => item.id !== id));
  }

  function useTranslationForEvaluation(item) {
    setEvalOriginal(item.original || "");
    setEvalCandidate(item.translated || "");
    setEvalPair(`${item.source || "?"} → ${item.target || "?"}`);
    setEvalEngine(item.model || "Unspecified");
    setEvalReference("");
    setEvalMessage("Add a human-verified reference translation to calculate the scores.");
    setActiveTab("evaluation");
  }

  function saveEvaluation() {
    if (!currentScores) {
      setEvalMessage("Enter both the generated translation and a human-verified reference.");
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleString(),
      pair: evalPair || "Not specified",
      original: evalOriginal.trim(),
      candidate: evalCandidate.trim(),
      reference: evalReference.trim(),
      engine: evalEngine || "Not specified",
      ...currentScores,
    };
    setEvaluationRows((previous) => [record, ...previous].slice(0, 100));
    setEvalMessage("Evaluation saved to this device.");
  }

  function setMode(mode) {
    setTranslationMode(mode);
    setOutputText("");
    setError("");
    setProcessingTime(null);
    setDownloadStatus("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">文</div>
          <div>
            <h1>TRANSLAYTER</h1>
            <p>Neural Machine Translation</p>
          </div>
        </div>

        <div className={`status ${isOfflineMode || apiOnline ? "online" : "offline"}`}>
          <span className="status-dot" />
          {isOfflineMode
            ? "Offline mode"
            : apiOnline
              ? "Online · Connected"
              : "Online · Unavailable"}
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="eyebrow">MULTILINGUAL NLP PLATFORM</div>
          <h2>Break language barriers with AI.</h2>
          <p>
            Translate your ideas across languages, wherever you are.
          </p>
        </section>

        <nav className="tabs" aria-label="Main navigation" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            ["translator", "Translator"],
            ["history", `History (${history.length})`],
            ["evaluation", "Evaluation"],
            ...(IS_NATIVE_APP ? [["settings", "Settings"]] : []),
            ["about", "About"],
          ].map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "active" : ""}
              aria-current={activeTab === tab ? "page" : undefined}
              style={{ flex: "1 1 auto", minWidth: 70, padding: "10px 12px", whiteSpace: "nowrap" }}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "translator" && (
          <>
            <section className="translator-card">
              <div className="language-bar">
                <div className="language-control">
                  <label htmlFor="source-language">FROM</label>
                  <select
                    id="source-language"
                    value={sourceLanguage}
                    onChange={(event) => {
                      setSourceLanguage(event.target.value);
                      setOutputText("");
                    }}
                  >
                    {Object.keys(availableLanguages).map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="swap-button"
                  onClick={swapLanguages}
                  title="Swap languages"
                  aria-label="Swap languages"
                >
                  ⇄
                </button>

                <div className="language-control">
                  <label htmlFor="target-language">TO</label>
                  <select
                    id="target-language"
                    value={targetLanguage}
                    onChange={(event) => {
                      setTargetLanguage(event.target.value);
                      setOutputText("");
                    }}
                  >
                    {Object.keys(availableLanguages).map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="translation-grid">
                <div className="text-panel">
                  <div className="panel-heading">
                    <span>Source text</span>
                    <button className="text-action" onClick={clearAll}>
                      Clear
                    </button>
                  </div>

                  <textarea
                    placeholder="Type your text here..."
                    value={inputText}
                    onChange={(event) => {
                      setInputText(event.target.value);
                      setOutputText("");
                      setError("");
                    }}
                    maxLength={2000}
                  />

                  <div className="panel-footer">
                    <span>{wordCount} words · {characterCount}/2000 characters</span>
                    <button
                      className="text-action"
                      onClick={() => copyText(inputText)}
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="text-panel result-panel">
                  <div className="panel-heading">
                    <span>AI translation</span>
                    <span className="model-tag">{isOfflineMode ? "Offline" : "Online"}</span>
                  </div>

                  <div
                    className={`output-area ${!outputText ? "empty" : ""}`}
                    aria-live="polite"
                  >
                    {loading
                      ? isOfflineMode
                        ? "Translating on your phone..."
                        : "Translating with the NLP model..."
                      : outputText || "Your translation will appear here."}
                  </div>

                  <div className="panel-footer">
                    <span>
                      {processingTime !== null
                        ? `Processed in ${processingTime}s`
                        : "Neural translation"}
                    </span>
                    <button
                      className="text-action"
                      onClick={() => copyText(outputText)}
                      disabled={!outputText}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}

              <div className="translator-bottom">
                <span className="helper-text">
                  Translation quality can vary by language and context.
                </span>

                <button
                  className="translate-button"
                  onClick={handleTranslate}
                  disabled={loading || !inputText.trim()}
                >
                  {loading ? "Translating..." : "Translate Now →"}
                </button>
              </div>
            </section>

            <div className="info-strip">
              <div>
                <strong>{Object.keys(availableLanguages).length}</strong>
                <span>Supported languages</span>
              </div>
              <div>
                <strong>{isOfflineMode ? "Offline" : "Online"}</strong>
                <span>Translation mode</span>
              </div>
              <div>
                <strong>AI</strong>
                <span>Neural translation</span>
              </div>
            </div>
          </>
        )}

        {activeTab === "history" && (
          <section className="content-card">
            <div className="section-heading">
              <div>
                <h3>Translation History</h3>
                <p>Your recent translations are saved in this browser.</p>
              </div>
              {history.length > 0 && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    if (window.confirm("Clear all translation history?")) {
                      setHistory([]);
                    }
                  }}
                >
                  Clear history
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="empty-history">
                No translations yet. Try translating a sentence.
              </p>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <div className="history-item" key={item.id}>
                    <div className="history-meta">
                      {item.source} → {item.target} · {item.date}
                    </div>
                    <p>{item.original}</p>
                    <p className="translated-history">
                      {item.translated}
                    </p>
                    <div className="history-actions">
                      <button onClick={() => loadHistory(item)}>
                        Open translation
                      </button>
                      <button onClick={() => deleteHistory(item.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "evaluation" && (
          <section className="content-card" style={{ display: "grid", gap: 16 }}>
            <div className="section-heading">
              <div>
                <h3>Translation Evaluation</h3>
                <p>Compare a translation with a human-verified reference. Scores are reference-similarity measures, not percentage accuracy.</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => useTranslationForEvaluation(history[0])}
                disabled={!history.length}
              >
                Use latest translation
              </button>
              {evalPair && <span className="helper-text">{evalPair}</span>}
            </div>

            <div className="text-panel" style={{ padding: 12 }}>
              <label htmlFor="eval-original" style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>Source text (optional)</label>
              <textarea id="eval-original" rows={2} value={evalOriginal} onChange={(e) => setEvalOriginal(e.target.value)} placeholder="Original sentence" style={{ width: "100%", minHeight: 72, boxSizing: "border-box" }} />
            </div>
            <div className="text-panel" style={{ padding: 12 }}>
              <label htmlFor="eval-candidate" style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>TRANSLAYTER output</label>
              <textarea id="eval-candidate" rows={3} value={evalCandidate} onChange={(e) => { setEvalCandidate(e.target.value); setEvalMessage(""); }} placeholder="Generated translation" style={{ width: "100%", minHeight: 90, boxSizing: "border-box" }} />
            </div>
            <div className="text-panel" style={{ padding: 12 }}>
              <label htmlFor="eval-reference" style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>Reference translation (human verified)</label>
              <textarea id="eval-reference" rows={3} value={evalReference} onChange={(e) => { setEvalReference(e.target.value); setEvalMessage(""); }} placeholder="Write a correct translation in the same target language" style={{ width: "100%", minHeight: 90, boxSizing: "border-box" }} />
            </div>

            {currentScores && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }} aria-live="polite">
                <div className="text-panel" style={{ padding: 16 }}>
                  <span className="helper-text">BLEU-4 · approximate</span>
                  <div style={{ fontSize: 30, fontWeight: 750 }}>{currentScores.bleu}<small style={{ fontSize: 14, fontWeight: 400 }}>/100</small></div>
                  <div style={{ height: 7, background: "#dfe7e8", borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
                    <div style={{ height: "100%", width: `${currentScores.bleu}%`, background: "#4b8a8c" }} />
                  </div>
                </div>
                <div className="text-panel" style={{ padding: 16 }}>
                  <span className="helper-text">chrF2 · character similarity</span>
                  <div style={{ fontSize: 30, fontWeight: 750 }}>{currentScores.chrf}<small style={{ fontSize: 14, fontWeight: 400 }}>/100</small></div>
                  <div style={{ height: 7, background: "#dfe7e8", borderRadius: 10, overflow: "hidden", marginTop: 8 }}>
                    <div style={{ height: "100%", width: `${currentScores.chrf}%`, background: "#4b8a8c" }} />
                  </div>
                </div>
              </div>
            )}
            <p className="helper-text" style={{ margin: 0 }}>
              BLEU checks matching word sequences (short-text score with smoothing).
              chrF compares character patterns and is especially helpful with morphologically rich languages.
              These local calculations are simplified teaching implementations, not official sacreBLEU results.
              A high score does not prove that every meaning is correct.
            </p>
            <div>
              <button type="button" className="translate-button" disabled={!currentScores} onClick={saveEvaluation}>
                Save to evaluation matrix
              </button>
              {evalMessage && <p role="status" style={{ marginTop: 10 }}>{evalMessage}</p>}
            </div>

            <div style={{ borderTop: "1px solid #dce4e6", paddingTop: 18 }}>
              <h3>Evaluation matrix</h3>
              <p className="helper-text">{evaluationRows.length} saved test{evaluationRows.length === 1 ? "" : "s"}{averageBleu !== null ? ` · Average BLEU: ${averageBleu} · Average chrF2: ${averageChrF}` : ""}</p>
              {evaluationRows.length === 0 ? (
                <p className="empty-history">No evaluations saved yet. Use a translation and add a reference to begin.</p>
              ) : (
                <div className="history-list">
                  {evaluationRows.map((item) => (
                    <div className="history-item" key={item.id}>
                      <div className="history-meta">{item.pair} · {item.date}</div>
                      {item.original && <p><strong>Source:</strong> {item.original}</p>}
                      <p><strong>Output:</strong> {item.candidate}</p>
                      <p><strong>Reference:</strong> {item.reference}</p>
                      <div style={{ fontWeight: 650 }}>BLEU {item.bleu}/100 · chrF2 {item.chrf}/100</div>
                      <div className="history-actions">
                        <button type="button" onClick={() => setEvaluationRows((previous) => previous.filter((row) => row.id !== item.id))}>Delete evaluation</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {IS_NATIVE_APP && activeTab === "settings" && (
          <section className="content-card" style={{ display: "grid", gap: 20 }}>
            <div>
              <h3>Translation Settings</h3>
              <p className="helper-text">Choose where translation runs and manage language downloads.</p>
            </div>
            <div>
              <strong>Translation mode</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <button type="button" className="secondary-button" aria-pressed={isOfflineMode} style={isOfflineMode ? { border: "2px solid #228b6b" } : {}} onClick={() => setMode("offline")}>Offline (on your phone)</button>
                <button type="button" className="secondary-button" aria-pressed={!isOfflineMode} style={!isOfflineMode ? { border: "2px solid #228b6b" } : {}} onClick={() => setMode("online")}>Online (server)</button>
              </div>
              <p className="helper-text" style={{ marginTop: 10 }}>
                {isOfflineMode
                  ? "Offline translation works without internet after the language models have been downloaded."
                  : "Online translation requires a reachable FastAPI server."}
              </p>
            </div>
            <div style={{ borderTop: "1px solid #dce4e6", paddingTop: 18 }}>
              <strong>Offline language downloads</strong>
              <p style={{ fontSize: 14 }}>
                In the Translator tab, choose the source and target languages. Then come back here and tap Download Models once. You can use downloaded models repeatedly without internet.
              </p>
              <p className="helper-text">Currently selected: {sourceLanguage} → {targetLanguage}</p>
              <button type="button" className="secondary-button" onClick={handleDownloadModels} disabled={downloading || loading}>
                {downloading ? "Downloading models…" : "Download selected models"}
              </button>
              {downloadStatus && <p role="status" style={{ fontSize: 14, marginTop: 10 }}>{downloadStatus}</p>}
            </div>
            <p className="helper-text" style={{ margin: 0 }}>
              Downloads are stored on your phone. If you delete the models, clear app data, or uninstall the app, you may need to download them again.
            </p>
          </section>
        )}

        {activeTab === "about" && (
          <section className="content-card">
            <h3>About TRANSLAYTER</h3>
            <p className="about-intro">
              TRANSLAYTER is a student-built translation application that
              integrates pretrained neural machine translation engines.
              The web/online engine is the NLLB-200 Transformer model, while
              offline Android translation runs through Google ML Kit. These
              are different models, and their results may differ.
            </p>

            {isOfflineMode && (
              <p style={{ marginTop: 8 }}>
                Offline translation uses Google ML Kit on the phone. Download
                language models before disconnecting from the internet.
                Japanese is available in offline mode.
              </p>
            )}
            {!isOfflineMode && (
              <div className="model-details">
              <div>
                <span>Model identifier</span>
                <strong>
                  {modelInfo?.name ||
                    "facebook/nllb-200-distilled-600M"}
                </strong>
              </div>
              <div>
                <span>Framework</span>
                <strong>
                  {modelInfo?.framework || "PyTorch + Transformers"}
                </strong>
              </div>
              <div>
                <span>Model type</span>
                <strong>
                  {modelInfo?.type || "Neural Machine Translation"}
                </strong>
              </div>
              <div>
                <span>Fine-tuned for this project?</span>
                <strong>
                  {modelInfo?.fine_tuned ? "Yes" : "No — pretrained baseline"}
                </strong>
              </div>
              </div>
            )}

            <p className="disclaimer">
              The project implements frontend, API integration, mobile packaging,
              offline model management and translation-quality evaluation.
              It does not claim that the pretrained NLLB-200 or Google ML Kit
              models were trained from scratch for this project. Translation
              quality varies by language and context; BLEU and chrF scores
              compare output to a supplied reference, not to absolute truth.
            </p>
          </section>
        )}
      </main>

      <footer className="footer">
        TRANSLAYTER · Multilingual translation platform
      </footer>
    </div>
  );
}
