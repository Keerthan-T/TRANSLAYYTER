
import { Capacitor } from '@capacitor/core';
import { Language, Translation } from '@capacitor-mlkit/translation';

// Convert NLLB-200 language codes to ML Kit language codes.
const languageMap = {
  eng_Latn: Language.English,
  kan_Knda: Language.Kannada,
  hin_Deva: Language.Hindi,
  tam_Taml: Language.Tamil,
  tel_Telu: Language.Telugu,
  jpn_Jpan: Language.Japanese,
};

// Download the models needed for an offline language pair.
export async function downloadOfflineModels(sourceCode, targetCode) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Offline translation is available on Android.');
  }

  const sourceLanguage = languageMap[sourceCode];
  const targetLanguage = languageMap[targetCode];

  if (!sourceLanguage || !targetLanguage) {
    throw new Error('Unsupported language selected.');
  }

  const { languages } = await Translation.getDownloadedModels();

  for (const language of new Set([sourceLanguage, targetLanguage])) {
    if (!languages.includes(language)) {
      await Translation.downloadModel({ language });
    }
  }
}

// Translate locally without accessing FastAPI.
export async function translateOffline(text, sourceCode, targetCode) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Offline translation is available on Android.');
  }

  const sourceLanguage = languageMap[sourceCode];
  const targetLanguage = languageMap[targetCode];

  if (!sourceLanguage || !targetLanguage) {
    throw new Error('Unsupported language selected.');
  }

  if (!text.trim() || sourceLanguage === targetLanguage) {
    return text;
  }

  const { languages } = await Translation.getDownloadedModels();

  if (!languages.includes(sourceLanguage) ||
      !languages.includes(targetLanguage)) {
    throw new Error('Download the language models while online first.');
  }

  const result = await Translation.translate({
    text,
    sourceLanguage,
    targetLanguage,
  });

  return result.text;
}
