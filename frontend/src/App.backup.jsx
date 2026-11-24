
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { downloadOfflineModels, translateOffline } from "./offlineTranslate";
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

  const characterCount = inputText.length;
  const wordCount = inputText.trim()
    ? inputText.trim().split(/\s+/).length
    : 0;

  async function handleDownloadModels() {
    setError("");
    setDownloadStatus("");
    if (sourceLanguage === targetLanguage) {
      setError("Choose two different languages first.");
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
      setDownloadStatus("");
      setError(err?.message || "Model download failed. Check your internet connection.");
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
            ? "Offline mode · On-device"
            : apiOnline
              ? "NLP Backend Connected"
              : "Backend Not Connected"}
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="eyebrow">MULTILINGUAL NLP PLATFORM</div>
          <h2>Break language barriers with AI.</h2>
          <p>
            Translate Indian languages and Japanese using neural translation.
            On Android, use downloaded models for offline translation.
          </p>
        </section>

        <nav className="tabs">
          <button
            className={activeTab === "translator" ? "active" : ""}
            onClick={() => setActiveTab("translator")}
          >
            Translator
          </button>
          <button
            className={activeTab === "history" ? "active" : ""}
            onClick={() => setActiveTab("history")}
          >
            History ({history.length})
          </button>
          <button
            className={activeTab === "about" ? "active" : ""}
            onClick={() => setActiveTab("about")}
          >
            About Model
          </button>
        </nav>

        {activeTab === "translator" && (
          <>
            {IS_NATIVE_APP && (
              <section className="content-card" style={{ marginBottom: 16, padding: 16 }}>
                <strong>Translation engine</strong>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-pressed={isOfflineMode}
                    style={isOfflineMode ? { border: "2px solid #228b6b" } : {}}
                    onClick={() => {
                      setTranslationMode("offline");
                      setError("");
                      setOutputText("");
                      setProcessingTime(null);
                    }}
                  >
                    Offline · ML Kit
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-pressed={!isOfflineMode}
                    style={!isOfflineMode ? { border: "2px solid #228b6b" } : {}}
                    onClick={() => {
                      setTranslationMode("online");
                      setError("");
                      setOutputText("");
                      setProcessingTime(null);
                    }}
                  >
                    Online · NLLB-200
                  </button>
                </div>
                <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
                  {isOfflineMode
                    ? "Translation runs on your phone after downloading the models. No laptop or internet is needed then."
                    : "Online mode needs your FastAPI backend at a phone-accessible address."}
                </p>
              </section>
            )}
            {isOfflineMode && (
              <section className="content-card" style={{ marginBottom: 16, padding: 16 }}>
                <strong>Prepare offline languages</strong>
                <p style={{ marginTop: 8, fontSize: 13 }}>
                  Select your From and To languages below, then download their
                  models once using Wi-Fi. Downloading can take some time.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleDownloadModels}
                  disabled={downloading || loading}
                >
                  {downloading ? "Downloading models..." : "Download selected language models"}
                </button>
                {downloadStatus && (
                  <p role="status" style={{ marginTop: 8, fontSize: 13 }}>
                    {downloadStatus}
                  </p>
                )}
              </section>
            )}
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
                    <span className="model-tag">
                      {isOfflineMode ? "ML Kit · Offline" : "NLLB-200"}
                    </span>
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
                        : isOfflineMode
                          ? "Google ML Kit · On-device"
                          : "Powered by neural NLP"}
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
                <strong>{isOfflineMode ? "ML Kit" : "600M"}</strong>
                <span>{isOfflineMode ? "Offline engine" : "Model parameters"}</span>
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

        {activeTab === "about" && (
          <section className="content-card">
            <h3>About the NLP Model</h3>
            <p className="about-intro">
              TRANSLAYTER has two translation engines: the web/online
              NLLB-200 Transformer model and Android's on-device Google ML Kit.
              These are different models, and their results may differ.
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
              This application demonstrates NLP inference using a
              pretrained model. Translation quality is not guaranteed.
              Dataset evaluation and fine-tuning are separate
              research tasks. Offline translation results come from Google
              ML Kit, not NLLB-200.
            </p>
          </section>
        )}
      </main>

      <footer className="footer">
        TRANSLAYTER · React + FastAPI/NLLB-200 (online) + Google ML Kit (offline Android)
      </footer>
    </div>
  );
}
