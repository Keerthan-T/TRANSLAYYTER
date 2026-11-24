# Force Hugging Face to use locally cached files
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"

# Path to your fine-tuned LoRA adapter
$env:TRANSLAYTER_ADAPTER_PATH = "C:\Users\keerthan\OneDrive\Desktop\codes\nlpTranslator\TrainedModels\TRANSLAYTER_NLLB_Kannada_LoRA"

Set-Location $PSScriptRoot

.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000