
from contextlib import asynccontextmanager
from functools import lru_cache
from threading import Lock
import time

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

# Prevent simultaneous requests from modifying
# the shared tokenizer's source-language setting.
translation_lock = Lock()


@lru_cache(maxsize=1)
def load_model():
    print("Loading NLLB translation model...")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_NAME
    )

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    model = model.to(device)
    model.eval()

    print(f"Model loaded successfully on {device}")
    return tokenizer, model, device


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Model loads once when the server starts.
    load_model()
    yield


app = FastAPI(
    title="LinguaBridge AI API",
    description="Multilingual NLP translation using NLLB-200",
    version="1.0.0",
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
        "message": "LinguaBridge AI Backend is running",
        "model": MODEL_NAME,
        "status": "ready",
    }


@app.get("/api/languages")
def get_languages():
    return {
        "languages": LANGUAGES
    }


@app.get("/api/model-info")
def get_model_info():
    return {
        "name": MODEL_NAME,
        "type": "Pretrained multilingual neural translation",
        "framework": "PyTorch + Transformers",
        "fine_tuned": False,
    }


@app.post("/api/translate")
def translate(request: TranslationRequest):

    text = request.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Please enter text to translate.",
        )

    if request.source_language not in LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Invalid source language.",
        )

    if request.target_language not in LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Invalid target language.",
        )

    if request.source_language == request.target_language:
        raise HTTPException(
            status_code=400,
            detail="Choose two different languages.",
        )

    start_time = time.perf_counter()

    try:
        with translation_lock:
            tokenizer, model, device = load_model()

            source_code = LANGUAGES[
                request.source_language
            ]
            target_code = LANGUAGES[
                request.target_language
            ]

            tokenizer.src_lang = source_code

            inputs = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=256,
            ).to(device)

            target_token_id = (
                tokenizer.convert_tokens_to_ids(
                    target_code
                )
            )

            with torch.inference_mode():
                output = model.generate(
                    **inputs,
                    forced_bos_token_id=target_token_id,
                    max_new_tokens=256,
                    num_beams=3,
                )

            translated_text = tokenizer.batch_decode(
                output,
                skip_special_tokens=True,
            )[0]

        elapsed = round(
            time.perf_counter() - start_time, 2
        )

        return {
            "original_text": text,
            "translated_text": translated_text,
            "source_language": request.source_language,
            "target_language": request.target_language,
            "model": MODEL_NAME,
            "processing_time_seconds": elapsed,
        }

    except Exception as error:
        print(f"Translation error: {error}")
        raise HTTPException(
            status_code=500,
            detail="Translation failed. Check backend logs.",
        )
