"""TRANSLAYTER FastAPI backend with optional English -> Kannada LoRA adapter.

Put this file at backend/main.py after backing up the existing file.
The trained adapter must be extracted and contain adapter_config.json and
adapter_model.safetensors. Specify its directory via TRANSLAYTER_ADAPTER_PATH,
or store it under the project-root trained_models/ (or train_models/).
"""

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Lock
import os
import time

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from peft import PeftModel
from pydantic import BaseModel, Field
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_NAME = "facebook/nllb-200-distilled-600M"

LANGUAGES = {
    "English": "eng_Latn",
    "Kannada": "kan_Knda",
    "Hindi": "hin_Deva",
    "Tamil": "tam_Taml",
    "Telugu": "tel_Telu",
    "Japanese": "jpn_Jpan",
}

PROJECT_ROOT = Path(__file__).resolve().parent.parent
translation_lock = Lock()


def find_adapter_dir() -> Path:
    """Locate extracted adapter files; reject ambiguous or missing locations."""
    configured = os.environ.get("TRANSLAYTER_ADAPTER_PATH")
    if configured:
        roots = [Path(configured).expanduser()]
    else:
        roots = [PROJECT_ROOT / name for name in (
            "trained_models", "train_models", "trained models", "train models"
        )]

    matches = []
    for root in roots:
        if not root.is_dir():
            continue
        # Some ZIPs extract into one extra directory.
        for candidate in [root, *root.glob("*/"), *root.glob("*/*/")]:
            if ((candidate / "adapter_config.json").is_file()
                    and (candidate / "adapter_model.safetensors").is_file()):
                matches.append(candidate.resolve())

    matches = list(dict.fromkeys(matches))
    if len(matches) != 1:
        raise RuntimeError(
            "Expected exactly one extracted LoRA adapter folder containing "
            "adapter_config.json and adapter_model.safetensors. "
            f"Found {len(matches)}: {matches}. "
            "Set TRANSLAYTER_ADAPTER_PATH to the exact folder if needed."
        )
    return matches[0]


@lru_cache(maxsize=1)
def load_model():
    print("Loading NLLB pretrained base model...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    base_model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

    adapter_dir = find_adapter_dir()
    print(f"Loading fine-tuned LoRA adapter from: {adapter_dir}")
    model = PeftModel.from_pretrained(base_model, str(adapter_dir), is_trainable=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    model.eval()
    print(f"TRANSLAYTER ready on {device}; adapter applied to English -> Kannada only")
    return tokenizer, model, device


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(
    title="TRANSLAYTER API",
    description="Multilingual NLLB-200 with English–Kannada LoRA fine-tuning",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source_language: str
    target_language: str


@app.get("/")
def home():
    return {
        "message": "TRANSLAYTER backend is running",
        "model": MODEL_NAME,
        "status": "ready",
        "fine_tuned_pair": "English -> Kannada",
    }


@app.get("/api/languages")
def get_languages():
    return {"languages": LANGUAGES}


@app.get("/api/model-info")
def get_model_info():
    return {
        "name": MODEL_NAME,
        "type": "Pretrained multilingual NMT + English–Kannada LoRA adapter",
        "framework": "PyTorch + Transformers + PEFT",
        "fine_tuned": True,
        "fine_tuned_pairs": ["English -> Kannada"],
        "base_model_pretrained": True,
    }


@app.post("/api/translate")
def translate(request: TranslationRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Please enter text to translate.")
    if request.source_language not in LANGUAGES:
        raise HTTPException(status_code=400, detail="Invalid source language.")
    if request.target_language not in LANGUAGES:
        raise HTTPException(status_code=400, detail="Invalid target language.")
    if request.source_language == request.target_language:
        raise HTTPException(status_code=400, detail="Choose two different languages.")

    start_time = time.perf_counter()
    fine_tuned_pair = request.source_language == "English" and request.target_language == "Kannada"

    try:
        with translation_lock:
            tokenizer, model, device = load_model()
            tokenizer.src_lang = LANGUAGES[request.source_language]
            inputs = tokenizer(
                text, return_tensors="pt", truncation=True, max_length=256
            ).to(device)
            target_token_id = tokenizer.convert_tokens_to_ids(
                LANGUAGES[request.target_language]
            )

            def generate():
                with torch.inference_mode():
                    return model.generate(
                        **inputs,
                        forced_bos_token_id=target_token_id,
                        max_new_tokens=256,
                        num_beams=3,
                    )

            if fine_tuned_pair:
                output = generate()
            else:
                # Same base weights, without the English–Kannada adapter.
                with model.disable_adapter():
                    output = generate()

            translated_text = tokenizer.batch_decode(
                output, skip_special_tokens=True
            )[0]

        elapsed = round(time.perf_counter() - start_time, 2)
        return {
            "original_text": text,
            "translated_text": translated_text,
            "source_language": request.source_language,
            "target_language": request.target_language,
            "model": MODEL_NAME + (" + English–Kannada LoRA" if fine_tuned_pair else " (base)"),
            "fine_tuned": fine_tuned_pair,
            "processing_time_seconds": elapsed,
        }
    except Exception as error:
        print(f"Translation error: {error}")
        raise HTTPException(
            status_code=500, detail="Translation failed. Check backend logs."
        ) from error
