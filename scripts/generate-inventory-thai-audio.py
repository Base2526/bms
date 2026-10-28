"""Build Inventory guide MP3s with the same pinned Thai voice used by the Restaurant guide."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

from fastthaig2p import TTS
import numpy as np
from pythainlp.tokenize import word_tokenize
from pythainlp.util import num_to_thaiword
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("--model-dir", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
requests = json.loads((root / ".test-output/inventory-narration/requests.json").read_text(encoding="utf-8"))
output = root / "apps/web/public/audio/inventory/th"
output.mkdir(parents=True, exist_ok=True)
checkpoint = root / ".test-output/inventory-narration/generated-kokoro.json"
generated = json.loads(checkpoint.read_text(encoding="utf-8")) if checkpoint.exists() else {}
vocabulary = list("กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลวศษสหฬอฮะัาำิีึืุูเแโใไๅ็่้๊๋์ ")
indices = {character: index for index, character in enumerate(vocabulary)}
pronunciation = {"SKU": "เอส เค ยู", "Snapshot": "สแนปช็อต", "Delta": "เดลตา"}


def normalize(text):
    for source, replacement in pronunciation.items():
        text = re.sub(re.escape(source), replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"\d+", lambda match: num_to_thaiword(int(match[0])), text)
    text = re.sub(r"[.,;:!?()/–—\-→↔+_]", " ", text).replace("ๆ", " ")
    text = " ".join(word_tokenize(text, engine="newmm", keep_whitespace=False))
    text = re.sub(r"\s+", " ", text).strip()
    unknown = set(text) - set(indices)
    if unknown:
        raise ValueError(f"Unpronounced characters {unknown!r} in {text!r}")
    return text


model_dir = Path(args.model_dir)
model_hashes = {
    "kokoro_thai.onnx": "a41a5ea020919e47df03226aebe72a64833bc666dfd6eeca6744d8c248270038",
    "thai_som.npy": "bdec2300889bd5db59c81a4f0e1604c78124abf6096d6e84d4db1bbeef122240",
    "config.json": "ea8e1a52dd433e27d953255d2bf340fc754ec62a60686d112136c4eee603709f",
}
for filename, expected in model_hashes.items():
    if hashlib.sha256((model_dir / filename).read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"Model checksum mismatch: {filename}")

tts = TTS(model_dir / "kokoro_thai.onnx", model_dir / "thai_som.npy", config_path=model_dir / "config.json", intra_op_threads=2)

for index, entry in enumerate(requests):
    text, identifier = entry["text"], entry["id"]
    path = output / f"{identifier}.mp3"
    normalized = normalize(text)
    if text in generated and generated[text]["spoken"] == normalized and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == generated[text]["sha256"]:
        continue
    chunks, chunk = [], ""
    for word in normalized.split():
        if len(chunk) + len(word) > 90 and chunk:
            chunks.append(chunk)
            chunk = ""
        chunk = (chunk + " " + word).strip()
    if chunk:
        chunks.append(chunk)
    started = time.monotonic()
    parts = []
    for item in chunks:
        parts.extend([tts.generate(item), np.zeros(2400, dtype=np.float32)])
    audio = np.concatenate(parts)
    peak = float(np.max(np.abs(audio)))
    if not np.isfinite(audio).all() or peak < 0.01 or len(audio) / 24000 > 90:
        raise RuntimeError(f"Invalid generated audio: {identifier}")
    audio = audio * min(1, 0.95 / peak)
    sf.write(str(path), audio, 24000, format="MP3", bitrate_mode="CONSTANT", compression_level=0.7)
    decoded, sample_rate = sf.read(str(path))
    generated[text] = {
        "file": f"/audio/inventory/th/{identifier}.mp3",
        "duration": round(len(decoded) / sample_rate, 3),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "spoken": normalized,
    }
    checkpoint.write_text(json.dumps(generated, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{index + 1}/{len(requests)} {identifier} duration={len(decoded) / sample_rate:.1f}s generated={time.monotonic() - started:.1f}s", flush=True)

if any(entry["text"] not in generated for entry in requests):
    raise RuntimeError("Incomplete inventory narration")
manifest = {entry["text"]: {key: generated[entry["text"]][key] for key in ["file", "duration"]} for entry in requests}
(root / "apps/web/app/learn/inventoryThaiAudio.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(output / "provenance.json").write_text(json.dumps({entry["id"]: generated[entry["text"]] for entry in requests}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Published manifest for {len(manifest)} cues.", flush=True)
