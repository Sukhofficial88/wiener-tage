# Генерация английской озвучки

1. Модель и голоса Kokoro-82M (Apache 2.0): файл `kokoro-quantized.onnx` и папка `voices/` из npm-пакета `expo-kokoro` (`package/build/`) или из репозитория onnx-community/Kokoro-82M-v1.0-ONNX. Голоса собираются в `voices.npz` (каждый `.bin` — массив float32 формы 510×1×256).
2. `pip install kokoro-onnx soundfile lameenc`
3. `node export-texts.mjs` — выгружает тексты монологов из `js/content/en.js` в `en-texts.json`.
4. `python3 gen.py ../../audio/en` — создаёт MP3 (64 кбит/с, моно) для всех героев; можно указать героев: `python3 gen.py ../../audio/en mozart`.

Пути к модели в `gen.py`: `expo/package/build/kokoro-quantized.onnx` и `voices.npz` рядом со скриптом.
