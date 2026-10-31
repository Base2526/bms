"""Offline Thai MP3 builder. No model, Python or provider credentials are shipped to clients.

Install onnxruntime==1.31.1 soundfile==0.14.0 pythainlp==5.4.0 numpy==2.5.4.
Export requests with restaurant-narration-export.mts first. See scripts/README.md.
Engine: FastThaiG2P / Thai Kokoro, Apache-2.0; see bundled asset attribution.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
import numpy as np
from fastthaig2p import TTS
import soundfile as sf
from pythainlp.tokenize import word_tokenize
from pythainlp.util import num_to_thaiword

parser = argparse.ArgumentParser()
parser.add_argument("--model-dir", required=True)
parser.add_argument("--limit", type=int)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
requests = json.loads((root / ".test-output/restaurant-narration/requests.json").read_text(encoding="utf-8"))
output = root / "apps/web/public/audio/restaurant/th"
output.mkdir(parents=True, exist_ok=True)
checkpoint = root / ".test-output/restaurant-narration/generated-kokoro.json"
generated = json.loads(checkpoint.read_text(encoding="utf-8")) if checkpoint.exists() else {}
vocabulary = list("กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลวศษสหฬอฮะัาำิีึืุูเแโใไๅ็่้๊๋์ ")
indices = {character: i for i, character in enumerate(vocabulary)}
pronunciation = {
    "table_id": "รหัสโต๊ะ", "IN_TRANSIT": "อยู่ระหว่างขนส่ง", "Dine-in": "รับประทานที่ร้าน",
    "e-Tax": "อีแท็กซ์", "Backend": "ระบบหลังบ้าน", "Takeaway": "ซื้อกลับบ้าน",
    "CANCELLED": "ยกเลิกแล้ว", "RECEIVED": "รับครบแล้ว", "PARTIAL": "รับบางส่วน",
    "CLOSED": "ปิดแล้ว", "MERGED": "รวมบิลแล้ว", "DRAFT": "ฉบับร่าง", "OPEN": "เปิดอยู่",
    "Movement": "รายการเคลื่อนไหว", "Supplier": "ซัพพลายเออร์", "Station": "สถานีงาน",
    "Commit": "บันทึกสำเร็จ", "Audit": "ประวัติการตรวจสอบ", "Flow": "โฟลว์",
    "API": "เอ พี ไอ", "BMS": "บี เอ็ม เอส", "KDS": "เค ดี เอส", "PDF": "พี ดี เอฟ",
    "PIN": "พิน", "POS": "พี โอ เอส", "PO": "พี โอ", "QR": "คิว อาร์",
    "SKU": "เอส เค ยู", "SOP": "เอส โอ พี", "AI": "เอ ไอ",
}

def normalize(text):
    for source, replacement in sorted(pronunciation.items(), key=lambda item: -len(item[0])):
        text = re.sub(re.escape(source), replacement, text, flags=re.IGNORECASE)
    text = re.sub(r"\d+", lambda match: num_to_thaiword(int(match[0])), text)
    text = re.sub(r"[.,;:!?()/–—\-→↔+_]", " ", text)
    text = text.replace("ๆ", " ")
    text = " ".join(word_tokenize(text, engine="newmm", keep_whitespace=False))
    text = re.sub(r"\s+", " ", text).strip()
    unknown = set(text) - set(indices)
    if unknown:
        raise ValueError(f"Unpronounced characters {unknown!r} in {text!r}")
    return text

for entry in requests:
    normalize(entry["text"])
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

for index, entry in enumerate(requests[:args.limit] if args.limit else requests):
    text, identifier = entry["text"], entry["id"]
    path = output / f"{identifier}.mp3"
    normalized = normalize(text)
    if text in generated and generated[text]["spoken"] == normalized and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == generated[text]["sha256"]:
        continue
    chunks, chunk = [], ""
    for word in normalized.split():
        if len(chunk) + len(word) > 90 and chunk:
            chunks.append(chunk); chunk = ""
        chunk = (chunk + " " + word).strip()
    if chunk:
        chunks.append(chunk)
    started = time.monotonic()
    parts = []
    for chunk in chunks:
        parts.extend([tts.generate(chunk), np.zeros(2400, dtype=np.float32)])
    audio = np.concatenate(parts)
    peak = float(np.max(np.abs(audio)))
    if not np.isfinite(audio).all() or peak < 0.01 or len(audio) / 24000 > 90:
        raise RuntimeError(f"Invalid generated audio: {identifier}")
    audio = audio * min(1, 0.95 / peak)
    sf.write(str(path), audio, 24000, format="MP3", bitrate_mode="CONSTANT", compression_level=0.7)
    decoded, sample_rate = sf.read(str(path))
    generated[text] = dict(file=f"/audio/restaurant/th/{identifier}.mp3", duration=round(len(decoded) / sample_rate, 3),
                           sha256=hashlib.sha256(path.read_bytes()).hexdigest(), spoken=normalized)
    checkpoint.write_text(json.dumps(generated, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{index+1}/{len(requests)} {identifier} duration={len(decoded)/sample_rate:.1f}s generated={time.monotonic()-started:.1f}s", flush=True)

if not args.limit:
    if any(entry["text"] not in generated for entry in requests):
        raise RuntimeError("Incomplete narration")
    manifest = {entry["text"]: {key: generated[entry["text"]][key] for key in ["file", "duration"]} for entry in requests}
    (root / "apps/web/components/marketing/restaurant/thaiAudio.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "provenance.json").write_text(json.dumps({entry["id"]: generated[entry["text"]] for entry in requests}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Published manifest for {len(manifest)} cues.", flush=True)
